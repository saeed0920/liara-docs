import { useState } from "react";
import { Card, Form, Input, Button, message } from "antd";
import { api } from "./api";

export default function Login({ onDone }) {
  const [loading, setLoading] = useState(false);

  async function submit(v) {
    setLoading(true);
    try {
      await api.login(v.username, v.password);
      onDone();
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <Card title="Admin Login" style={{ width: 320 }}>
        <Form onFinish={submit} layout="vertical">
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
}
