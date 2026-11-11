"use client";

import { useState } from "react";
import { neonAuthClient } from "../../lib/auth/neon-client";

// Isolated smoke-test page. Does NOT replace the existing Purchasing login.
// Neon signups are disabled until school accounts and role mapping are migrated.
export default function NeonAuthCheck() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setStatus("");
    try {
      const response = await neonAuthClient.signIn.email({ email, password });
      if (response.error) {
        setStatus(response.error.message || "Neon authentication failed.");
      } else {
        const session = await neonAuthClient.getSession();
        setStatus(session.data?.user ? "Neon Auth session established." : "Signed in; session validation pending.");
      }
    } catch {
      setStatus("Neon Auth could not establish a session.");
    } finally {
      setWorking(false);
    }
  }

  async function signOut() {
    setWorking(true);
    try {
      await neonAuthClient.signOut();
      setStatus("Neon Auth session closed.");
    } catch {
      setStatus("Sign-out failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main style={{minHeight:"100vh",maxWidth:520,margin:"auto",padding:"60px 24px"}}>
      <h1>Purchasing — Neon Authentication Check</h1>
      <p>Restricted migration diagnostics. This page is not the live Purchasing login.
        Existing school accounts must be migrated and approved first.</p>
      <form onSubmit={signIn} style={{display:"grid",gap:12}}>
        <label>Email<input required type="email" autoComplete="username" value={email}
          onChange={event=>setEmail(event.target.value)} style={{display:"block",width:"100%"}} /></label>
        <label>Password<input required type="password" autoComplete="current-password" value={password}
          onChange={event=>setPassword(event.target.value)} style={{display:"block",width:"100%"}} /></label>
        <button type="submit" disabled={working}>Verify Neon login</button>
      </form>
      <button type="button" disabled={working} onClick={signOut}>Sign out of test session</button>
      <p role="status" aria-live="polite">{status}</p>
    </main>
  );
}
