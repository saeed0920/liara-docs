import { useEffect, useState } from "react";
import { Card, Form, Input, Button, message, Typography } from "antd";
import { api } from "./api";

export default function Settings() {
  const [form] = Form.useForm();
  const [masked, setMasked] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getConfig().then((c) => {
      setMasked(c.avalaiKeyMasked);
      form.setFieldsValue({
        avalaiBaseUrl: c.avalaiBaseUrl,
        defaultModel: c.defaultModel,
      });
    });
  }, [form]);

  async function submit(v) {
    setLoading(true);
    try {
      // Only send the key if the admin typed a new one (write-only field).
      const body = { avalaiBaseUrl: v.avalaiBaseUrl, defaultModel: v.defaultModel };
      if (v.avalaiKey) body.avalaiKey = v.avalaiKey;
      await api.putConfig(body);
      form.setFieldValue("avalaiKey", "");
      const c = await api.getConfig();
      setMasked(c.avalaiKeyMasked);
      message.success("Saved");
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="AvalAI Settings" style={{ maxWidth: 560 }}>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item label="Current key">
          <Typography.Text code>{masked ?? "not set"}</Typography.Text>
        </Form.Item>
        <Form.Item name="avalaiKey" label="New API key (leave blank to keep current)">
          <Input.Password placeholder="sk-..." autoComplete="off" />
        </Form.Item>
        <Form.Item name="avalaiBaseUrl" label="Base URL" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="defaultModel" label="Default model" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>
          Save
        </Button>
      </Form>
    </Card>
  );
}
