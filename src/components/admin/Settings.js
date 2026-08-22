import { useEffect, useState } from "react";
import { Button, Card, Form, Input, InputNumber, message, Select, Switch, Typography } from "antd";
import { api } from "./api";

export default function Settings() {
  const [form] = Form.useForm();
  const [masked, setMasked] = useState(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.getConfig().then((c) => {
      setMasked(c.avalaiKeyMasked);
      form.setFieldsValue({
        avalaiBaseUrl: c.avalaiBaseUrl,
        defaultModel: c.defaultModel,
        assistantEnabled: c.assistantEnabled,
        assistantMinuteLimit: c.assistantMinuteLimit,
        assistantDayLimit: c.assistantDayLimit,
      });
    }).catch(() => message.error("Unable to load settings"));
  }, [form]);

  async function submit(v) {
    setLoading(true);
    try {
      // Only send the key if the admin typed a new one (write-only field).
      const body = {
        avalaiBaseUrl: v.avalaiBaseUrl,
        defaultModel: v.defaultModel,
        assistantEnabled: v.assistantEnabled,
        assistantMinuteLimit: v.assistantMinuteLimit,
        assistantDayLimit: v.assistantDayLimit,
      };
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

  async function testConnection() {
    setTesting(true);
    try {
      const values = await form.validateFields(["avalaiKey", "avalaiBaseUrl", "defaultModel"]);
      const body = { avalaiBaseUrl: values.avalaiBaseUrl, defaultModel: values.defaultModel };
      if (values.avalaiKey) body.avalaiKey = values.avalaiKey;
      await api.testConfig(body);
      message.success("Connection succeeded");
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card title="AvalAI Settings" style={{ maxWidth: 560 }}>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item label="Current key">
          <Typography.Text code>{masked ?? "not set"}</Typography.Text>
        </Form.Item>
        <Form.Item name="avalaiKey" label="New API key (leave blank to keep current)">
          <Input.Password placeholder="sk-..." autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="avalaiBaseUrl" label="Base URL" rules={[{ required: true }]}>
          <Select options={[{ value: "https://api.avalai.ir/v1", label: "https://api.avalai.ir/v1" }]} />
        </Form.Item>
        <Form.Item name="defaultModel" label="Default model" rules={[{ required: true }]}>
          <Select options={[{ value: "gpt-4o-mini", label: "gpt-4o-mini" }]} />
        </Form.Item>
        <Form.Item name="assistantEnabled" label="Enable docs assistant" valuePropName="checked" initialValue={false}>
          <Switch />
        </Form.Item>
        <Form.Item name="assistantMinuteLimit" label="Requests per minute" rules={[{ required: true, type: "number", min: 1, max: 1000 }]}>
          <InputNumber min={1} max={1000} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="assistantDayLimit" label="Requests per day" rules={[{ required: true, type: "number", min: 1, max: 100000 }]}>
          <InputNumber min={1} max={100000} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>
          Save
        </Button>
        <Button onClick={testConnection} loading={testing} style={{ marginInlineStart: 8 }}>
          Test connection
        </Button>
      </Form>
    </Card>
  );
}
