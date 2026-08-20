import { useEffect, useState } from "react";
import { Card, Col, Row, Select, Statistic, Spin } from "antd";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { api } from "./api";

const fmtDay = (d) => new Date(d).toISOString().slice(5, 10);

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.stats(days).then(setData).catch(() => setData(null));
  }, [days]);

  if (!data) return <Spin style={{ display: "block", marginTop: 80 }} />;

  const chart = data.daily.map((d) => ({ ...d, label: fmtDay(d.day) }));

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Select
          value={days}
          onChange={setDays}
          options={[
            { value: 1, label: "Last 1 day" },
            { value: 7, label: "Last 7 days" },
            { value: 30, label: "Last 30 days" },
          ]}
        />
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="Requests" value={data.totals.requests} /></Card></Col>
        <Col span={6}><Card><Statistic title="Unique Users" value={data.totals.users} /></Card></Col>
        <Col span={6}><Card><Statistic title="Total Tokens" value={data.totals.tokens} /></Card></Col>
        <Col span={6}><Card><Statistic title="Est. Cost ($)" precision={4} value={data.totals.cost} /></Card></Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}><Card><Statistic title="Latency p50 (ms)" value={data.latency.p50} /></Card></Col>
        <Col span={12}><Card><Statistic title="Latency p95 (ms)" value={data.latency.p95} /></Card></Col>
      </Row>

      <Card title="Requests over time" style={{ marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="requests" stroke="#1677ff" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Tokens & cost" style={{ marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis yAxisId="l" />
            <YAxis yAxisId="r" orientation="right" />
            <Tooltip />
            <Legend />
            <Bar yAxisId="l" dataKey="tokens" fill="#1677ff" name="tokens" />
            <Bar yAxisId="r" dataKey="cost" fill="#52c41a" name="cost ($)" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Errors & rate-limit hits">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="errors" fill="#ff4d4f" name="errors" />
            <Bar dataKey="rateLimited" fill="#faad14" name="rate limited" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
