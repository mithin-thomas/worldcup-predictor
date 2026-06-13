import { useMe, GoogleSignInButton, useLogout } from "./lib/auth";

export default function App() {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();

  if (isLoading) return <div className="card">Loading…</div>;

  if (!me) {
    return (
      <div className="card">
        <h1>SayScore</h1>
        <p className="muted">Sign in with your sayonetech.com Google account.</p>
        <GoogleSignInButton />
      </div>
    );
  }

  return (
    <div className="card">
      <h1>SayScore</h1>
      <p>Signed in as <strong>{me.name || me.email}</strong> ({me.role})</p>
      <p className="muted">{me.email}</p>
      <button className="btn-brand" onClick={() => logout.mutate()}>Log out</button>
    </div>
  );
}
