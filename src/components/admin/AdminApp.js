import { useEffect, useState } from "react";
import { Layout, Menu, Button, Spin } from "antd";
import { api } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import Settings from "./Settings";

export default function AdminApp() {
  const [authed, setAuthed] = useState(null); // null = checking
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    api.me().then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <Spin style={{ display: "block", marginTop: 120 }} />;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header style={{ display: "flex", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 600, marginRight: 32 }}>Chat Admin</div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[tab]}
          onClick={(e) => setTab(e.key)}
          style={{ flex: 1 }}
          items={[
            { key: "dashboard", label: "Dashboard" },
            { key: "settings", label: "Settings" },
          ]}
        />
        <Button
          onClick={async () => {
            await api.logout();
            setAuthed(false);
          }}
        >
          Logout
        </Button>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>
        {tab === "dashboard" ? <Dashboard /> : <Settings />}
      </Layout.Content>
    </Layout>
  );
}
