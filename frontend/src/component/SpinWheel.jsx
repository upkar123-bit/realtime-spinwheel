import React from 'react';

export default function SpinWheel({ segments = [] }) {
  // Very simple static representation; for animation integrate CSS transforms and map index->rotation
  return (
    <div style={{
      width: 200, height: 200, borderRadius: '50%', border: '6px solid #444',
      display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative'
    }}>
      <div style={{ textAlign: 'center' }}>
        {segments.map((s, i) => <div key={i}>{s.label}</div>)}
      </div>
    </div>
  );
}
