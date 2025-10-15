import React, { useEffect, useState } from "react";
import { socket } from "../socket";
import axios from "axios";
import SpinWheel from "./SpinWheel";

export default function Lobby({ userId }) {
  const [wheels, setWheels] = useState([]);
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

  // --- Lifecycle ---
  useEffect(() => {
    socket.connect();

    // Receive new wheels in real time
    socket.on("wheel:created", (wheel) => {
      setWheels((prev) => [wheel, ...prev]);
    });

    // Receive player join updates
    socket.on("wheel:player_joined", ({ wheelId, userId }) => {
      setWheels((prev) =>
        prev.map((w) =>
          w.id === wheelId
            ? { ...w, joins: [...(w.joins || []), { userId }] }
            : w
        )
      );
    });

    // Receive finished wheel updates
    socket.on("wheel:finished", (data) => {
      alert(
        `🎉 Wheel "${data.wheelId}" finished!\nWinner: ${data.winner}\nPrize: ${data.payout}`
      );
      setWheels((prev) =>
        prev.map((w) =>
          w.id === data.wheelId
            ? { ...w, status: "finished", winner: data.winner }
            : w
        )
      );
    });

    fetchWheels();
    return () => {
      socket.off("wheel:created");
      socket.off("wheel:player_joined");
      socket.off("wheel:finished");
      socket.disconnect();
    };
  }, []);

  // --- Functions ---
  async function fetchWheels() {
    const res = await axios.get(`${API_URL}/wheels`);
    setWheels(res.data);
  }

  function createWheel() {
    const segments = [
      { label: "10", weight: 1 },
      { label: "20", weight: 1 },
      { label: "50", weight: 1 },
      { label: "100", weight: 1 },
    ];
    socket.emit(
      "wheel:create",
      {
        hostId: userId,
        title: `Demo Wheel ${Date.now()}`,
        segments,
        entryFee: 100,
        maxPlayers: 5,
      },
      (res) => {
        if (!res.success) alert("❌ " + res.message);
      }
    );
  }

  function joinWheel(wheelId) {
    socket.emit("wheel:join", { userId, wheelId }, (res) => {
      if (!res.success) alert("❌ " + res.message);
    });
  }

  function startWheel(wheelId) {
    socket.emit("wheel:start", { wheelId }, (res) => {
      if (!res.success) alert("❌ " + res.message);
    });
  }

  // --- UI ---
  return (
    <div style={{ padding: 20 }}>
      <h2>🎯 SpinWheel Lobby</h2>
      <button
        onClick={createWheel}
        style={{
          marginBottom: 20,
          padding: "8px 12px",
          borderRadius: 8,
          border: "none",
          background: "#28a745",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        ➕ Create New Wheel
      </button>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        {wheels.length === 0 && <p>No wheels yet. Create one!</p>}

        {wheels.map((w) => (
          <div
            key={w.id}
            style={{
              border: "1px solid #ccc",
              padding: 15,
              borderRadius: 10,
              width: 250,
              textAlign: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
            }}
          >
            <h4>{w.title}</h4>
            <p>💰 Entry Fee: {w.entryFee}</p>
            <p>👥 Players: {(w.joins || []).length}</p>
            <p>📜 Status: {w.status || "waiting"}</p>
            <SpinWheel segments={w.segments || []} />

            {w.status === "waiting" && (
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() => joinWheel(w.id)}
                  style={{
                    padding: "6px 10px",
                    marginRight: 10,
                    border: "none",
                    background: "#007bff",
                    color: "#fff",
                    borderRadius: 5,
                    cursor: "pointer",
                  }}
                >
                  Join
                </button>
                <button
                  onClick={() => startWheel(w.id)}
                  style={{
                    padding: "6px 10px",
                    border: "none",
                    background: "#ffc107",
                    color: "#000",
                    borderRadius: 5,
                    cursor: "pointer",
                  }}
                >
                  Start
                </button>
              </div>
            )}

            {w.status === "finished" && (
              <p style={{ color: "green" }}>
                🏆 Winner: {w.winner || "unknown"}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
