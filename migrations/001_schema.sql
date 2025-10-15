-- Create schema for spinwheel game
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  coins BIGINT NOT NULL DEFAULT 0,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spin_wheels (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, active, aborted, finished
  owner_id INTEGER REFERENCES users(id),
  entry_fee BIGINT NOT NULL DEFAULT 100,
  winner_pool BIGINT DEFAULT 0,
  admin_pool BIGINT DEFAULT 0,
  app_pool BIGINT DEFAULT 0,
  min_participants INTEGER DEFAULT 3,
  created_at TIMESTAMP DEFAULT now(),
  started_at TIMESTAMP,
  finished_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spin_participants (
  id SERIAL PRIMARY KEY,
  wheel_id INTEGER REFERENCES spin_wheels(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  joined_at TIMESTAMP DEFAULT now(),
  eliminated_at TIMESTAMP,
  eliminated_order INTEGER
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  amount BIGINT NOT NULL,
  type TEXT NOT NULL, -- credit/debit
  meta JSONB,
  created_at TIMESTAMP DEFAULT now()
);

-- seed simple config
INSERT INTO config (key, value) VALUES
('fee_split_winner_pct','70'),
('fee_split_admin_pct','20'),
('fee_split_app_pct','10')
ON CONFLICT (key) DO NOTHING;

-- seed an admin and two users (developer can add more)
INSERT INTO users (username, coins, is_admin) VALUES
('admin', 0, true),
('alice', 10000, false),
('bob', 10000, false)
ON CONFLICT (username) DO NOTHING;
