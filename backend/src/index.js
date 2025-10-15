/**
 * Minimal Spin Wheel backend implementing core requirements:
 * - Admin can create a wheel (only one active at a time)
 * - Users join by paying coins (atomic DB tx)
 * - Auto-start after 3 minutes or manual start
 * - Eliminate one user every 7 seconds until winner
 * - Real-time updates via Socket.IO
 *
 * Uses PostgreSQL and basic SQL transactions for coin safety.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');

dotenv.config();
const PORT = process.env.PORT || 4000;
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({ connectionString: DATABASE_URL });

const app = express();
app.use(express.json());
app.use(require('cors')());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/**
 * Utility DB helpers
 */
async function query(text, params){ return pool.query(text, params); }

async function getConfigSplit(){
  const res = await query("SELECT key,value FROM config WHERE key LIKE 'fee_split_%'");
  const map = {};
  res.rows.forEach(r=> map[r.key] = Number(r.value));
  return {
    winner_pct: map['fee_split_winner_pct']||70,
    admin_pct: map['fee_split_admin_pct']||20,
    app_pct: map['fee_split_app_pct']||10
  };
}

/**
 * Socket.IO namespaces / events:
 * - Clients join room 'wheel' to receive updates
 */
io.on('connection', socket=>{
  console.log('socket connected', socket.id);
  socket.on('joinRoom', room => {
    socket.join(room);
  });
});

/**
 * Simple endpoints for admin / user actions
 */

// Create wheel (admin only by user id)
app.post('/api/wheels', async (req,res)=>{
  try{
    const {owner_id, entry_fee} = req.body;
    // check admin
    const adm = await query('SELECT is_admin FROM users WHERE id=$1', [owner_id]);
    if(!adm.rowCount || !adm.rows[0].is_admin) return res.status(403).json({error:'only admin'});
    // ensure no active wheel
    const active = await query("SELECT * FROM spin_wheels WHERE status IN ('pending','active')");
    if(active.rowCount>0) return res.status(400).json({error:'active wheel exists'});
    const r = await query('INSERT INTO spin_wheels (owner_id, entry_fee) VALUES ($1,$2) RETURNING *',[owner_id, entry_fee||100]);
    const wheel = r.rows[0];
    // broadcast
    io.emit('wheelCreated', wheel);
    // schedule auto-start after 3 minutes (180s)
    setTimeout(()=> autoStartWheel(wheel.id), 180000);
    res.json(wheel);
  }catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

// Join wheel (pay entry fee)
app.post('/api/wheels/:id/join', async (req,res)=>{
  const wheelId = Number(req.params.id);
  const {user_id} = req.body;
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    // lock wheel row
    const wq = await client.query('SELECT * FROM spin_wheels WHERE id=$1 FOR UPDATE', [wheelId]);
    if(wq.rowCount===0) throw new Error('wheel not found');
    const wheel = wq.rows[0];
    if(wheel.status!=='pending') throw new Error('wheel not joinable');
    // lock user
    const uq = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [user_id]);
    if(uq.rowCount===0) throw new Error('user not found');
    const user = uq.rows[0];
    if(Number(user.coins) < Number(wheel.entry_fee)) throw new Error('insufficient coins');
    // deduct coins
    const newCoins = Number(user.coins) - Number(wheel.entry_fee);
    await client.query('UPDATE users SET coins=$1 WHERE id=$2', [newCoins, user_id]);
    await client.query("INSERT INTO transactions (user_id, amount, type, meta) VALUES ($1,$2,$3,$4)",[user_id, -wheel.entry_fee, 'debit', JSON.stringify({wheel:wheelId})]);
    // fee split
    const splits = await getConfigSplit();
    const winnerAmt = Math.floor(wheel.entry_fee * splits.winner_pct/100);
    const adminAmt = Math.floor(wheel.entry_fee * splits.admin_pct/100);
    const appAmt = Number(wheel.entry_fee) - winnerAmt - adminAmt;
    // update accumulators on wheel
    await client.query('UPDATE spin_wheels SET winner_pool = winner_pool + $1, admin_pool = admin_pool + $2, app_pool = app_pool + $3 WHERE id=$4',
      [winnerAmt, adminAmt, appAmt, wheelId]);
    // add participant
    await client.query('INSERT INTO spin_participants (wheel_id, user_id) VALUES ($1,$2)', [wheelId, user_id]);
    await client.query('COMMIT');
    // emit update
    const participants = await query('SELECT p.*, u.username FROM spin_participants p JOIN users u ON p.user_id=u.id WHERE wheel_id=$1', [wheelId]);
    io.emit('participantJoined', {wheelId, participants: participants.rows});
    res.json({ok:true});
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    res.status(400).json({error: e.message});
  }finally{
    client.release();
  }
});

// Manual start by admin
app.post('/api/wheels/:id/start', async (req,res)=>{
  const wheelId = Number(req.params.id);
  const {owner_id} = req.body;
  try{
    // validate owner is admin and wheel pending
    const ow = await query('SELECT is_admin FROM users WHERE id=$1',[owner_id]);
    if(!ow.rowCount || !ow.rows[0].is_admin) return res.status(403).json({error:'only admin'});
    const wq = await query('SELECT * FROM spin_wheels WHERE id=$1',[wheelId]);
    if(!wq.rowCount) return res.status(404).json({error:'wheel not found'});
    const wheel = wq.rows[0];
    if(wheel.status!=='pending') return res.status(400).json({error:'wheel not startable'});
    // check participants
    const parts = await query('SELECT COUNT(*) FROM spin_participants WHERE wheel_id=$1',[wheelId]);
    const count = Number(parts.rows[0].count || 0);
    if(count < wheel.min_participants) return res.status(400).json({error:'not enough participants'});
    // mark active and start elimination
    await query("UPDATE spin_wheels SET status='active', started_at=now() WHERE id=$1", [wheelId]);
    io.emit('wheelStarted', {wheelId});
    startElimination(wheelId);
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

/**
 * Auto-start used by timer when a wheel is created.
 */
async function autoStartWheel(wheelId){
  try{
    const wq = await query('SELECT * FROM spin_wheels WHERE id=$1',[wheelId]);
    if(!wq.rowCount) return;
    const wheel = wq.rows[0];
    if(wheel.status!=='pending') return;
    const parts = await query('SELECT COUNT(*) FROM spin_participants WHERE wheel_id=$1',[wheelId]);
    const count = Number(parts.rows[0].count || 0);
    if(count < wheel.min_participants){
      // abort and refund
      await refundWheel(wheelId, 'not_enough_participants');
      io.emit('wheelAborted', {wheelId, reason:'not_enough_participants'});
      return;
    }
    await query("UPDATE spin_wheels SET status='active', started_at=now() WHERE id=$1", [wheelId]);
    io.emit('wheelStarted', {wheelId});
    startElimination(wheelId);
  }catch(e){ console.error('autoStart error', e); }
}

/**
 * Refund all participants (called when wheel aborted)
 */
async function refundWheel(wheelId, reason){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const parts = await client.query('SELECT user_id FROM spin_participants WHERE wheel_id=$1 FOR UPDATE',[wheelId]);
    for(const p of parts.rows){
      // credit each user entry_fee back (naive: look up wheel's entry_fee)
      const w = await client.query('SELECT entry_fee FROM spin_wheels WHERE id=$1',[wheelId]);
      const fee = Number(w.rows[0].entry_fee);
      await client.query('UPDATE users SET coins = coins + $1 WHERE id=$2',[fee, p.user_id]);
      await client.query('INSERT INTO transactions (user_id, amount, type, meta) VALUES ($1,$2,$3,$4)', [p.user_id, fee, 'credit', JSON.stringify({wheel:wheelId, reason})]);
    }
    await client.query("UPDATE spin_wheels SET status='aborted', finished_at=now() WHERE id=$1", [wheelId]);
    await client.query('COMMIT');
  }catch(e){ await client.query('ROLLBACK').catch(()=>{}); console.error('refund error', e); }finally{ client.release(); }
}

/**
 * Start elimination loop: eliminate one user every 7 seconds until one remains.
 */
async function startElimination(wheelId){
  // load participants (random order)
  const parts = await query('SELECT p.id, p.user_id, u.username FROM spin_participants p JOIN users u ON p.user_id=u.id WHERE wheel_id=$1 AND p.eliminated_at IS NULL', [wheelId]);
  let participants = parts.rows.slice();
  if(participants.length===0) return;
  // shuffle
  participants = participants.sort(()=> Math.random()-0.5);
  let idx = 0;
  async function eliminateOne(){
    // re-query active participants to make sure count up-to-date
    const active = await query('SELECT id, user_id FROM spin_participants WHERE wheel_id=$1 AND eliminated_at IS NULL', [wheelId]);
    if(active.rowCount <= 1){
      // declare winner
      const remaining = active.rows;
      if(remaining.length===1){
        await finalizeWinner(wheelId, remaining[0].user_id);
      } else {
        // no participants left
        await query("UPDATE spin_wheels SET status='finished', finished_at=now() WHERE id=$1", [wheelId]);
      }
      return;
    }
    // eliminate the next participant in the shuffled array who is still active
    let eliminated = null;
    while(idx < participants.length){
      const cand = participants[idx++];
      const check = await query('SELECT * FROM spin_participants WHERE id=$1 AND eliminated_at IS NULL', [cand.id]);
      if(check.rowCount>0){ eliminated = cand; break; }
    }
    if(!eliminated){
      // fallback: pick first active
      const cand2 = active.rows[0];
      eliminated = {id:cand2.id, user_id:cand2.user_id};
    }
    // mark eliminated
    await query('UPDATE spin_participants SET eliminated_at=now(), eliminated_order=(SELECT COUNT(*) FROM spin_participants WHERE wheel_id=$1) WHERE id=$2', [wheelId, eliminated.id]);
    // emit elimination event
    const user = await query('SELECT username FROM users WHERE id=$1',[eliminated.user_id]);
    io.emit('userEliminated', {wheelId, user_id: eliminated.user_id, username: user.rows[0].username});
    // schedule next elimination after 7 seconds
    setTimeout(eliminateOne, 7000);
  }
  // start first elimination after 7s
  setTimeout(eliminateOne, 7000);
}

/**
 * Finalize winner: credit winner_pool and admin_pool appropriately.
 */
async function finalizeWinner(wheelId, winnerUserId){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    // lock wheel
    const wq = await client.query('SELECT winner_pool, admin_pool, owner_id FROM spin_wheels WHERE id=$1 FOR UPDATE', [wheelId]);
    if(wq.rowCount===0) throw new Error('wheel missing');
    const {winner_pool, admin_pool, owner_id} = wq.rows[0];
    // credit winner
    if(Number(winner_pool) > 0){
      await client.query('UPDATE users SET coins = coins + $1 WHERE id=$2', [winner_pool, winnerUserId]);
      await client.query('INSERT INTO transactions (user_id, amount, type, meta) VALUES ($1,$2,$3,$4)', [winnerUserId, winner_pool, 'credit', JSON.stringify({wheel:wheelId,role:'winner'})]);
    }
    // credit admin (owner)
    if(Number(admin_pool) > 0){
      await client.query('UPDATE users SET coins = coins + $1 WHERE id=$2', [admin_pool, owner_id]);
      await client.query('INSERT INTO transactions (user_id, amount, type, meta) VALUES ($1,$2,$3,$4)', [owner_id, admin_pool, 'credit', JSON.stringify({wheel:wheelId,role:'admin'})]);
    }
    await client.query("UPDATE spin_wheels SET status='finished', finished_at=now() WHERE id=$1", [wheelId]);
    await client.query('COMMIT');
    io.emit('wheelFinished', {wheelId, winnerUserId});
  }catch(e){ await client.query('ROLLBACK').catch(()=>{}); console.error('finalize error', e); }finally{ client.release(); }
}

/**
 * Utility endpoints for demo
 */
app.get('/api/wheels', async (req,res)=>{
  const r = await query('SELECT * FROM spin_wheels ORDER BY id DESC LIMIT 10');
  res.json(r.rows);
});
app.get('/api/wheels/:id/participants', async (req,res)=>{
  const r = await query('SELECT p.*, u.username FROM spin_participants p JOIN users u ON p.user_id=u.id WHERE wheel_id=$1', [req.params.id]);
  res.json(r.rows);
});
app.get('/api/users', async (req,res)=>{
  const r = await query('SELECT id,username,coins,is_admin FROM users');
  res.json(r.rows);
});
app.get('/api/config', async (req,res)=>{
  const r = await query('SELECT key,value FROM config');
  res.json(r.rows);
});

server.listen(PORT, ()=> console.log('Server listening', PORT));
