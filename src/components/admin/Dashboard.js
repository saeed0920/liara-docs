import { useEffect, useState } from "react";
import { Card, Col, Descriptions, Input, Row, Select, Space, Spin, Statistic, Table, Tag, Typography } from "antd";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "./api";

const fmtDay = (value) => new Date(value).toISOString().slice(5, 10);
const statusColor = (value) => value === "passed" || value === true ? "green" : value === "failed" || value === false ? "red" : "gold";

export default function Dashboard() {
  const [filters, setFilters] = useState({ days: 7, status: "all", model: "", requestId: "" });
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.stats(filters).then(setData).catch(() => setData(null));
  }, [filters]);

  if (!data) return <Spin style={{ display: "block", marginTop: 80 }} />;
  const chart = data.daily.map((row) => ({ ...row, label: `${fmtDay(row.day)} ${row.requestType}` }));

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select value={filters.days} onChange={(days) => setFilters((value) => ({ ...value, days }))} options={[1, 7, 30, 90].map((value) => ({ value, label: `Last ${value} day${value > 1 ? "s" : ""}` }))} />
        <Select value={filters.status} onChange={(status) => setFilters((value) => ({ ...value, status }))} options={["all", "ok", "error", "timeout", "cancelled"].map((value) => ({ value, label: value }))} />
        <Select style={{ minWidth: 190 }} value={filters.model} onChange={(model) => setFilters((value) => ({ ...value, model }))} options={[{ value: "", label: "All models" }, ...data.models.map((model) => ({ value: model, label: model }))]} />
        <Input.Search allowClear placeholder="Safe request ID drill-down" style={{ width: 310 }} onSearch={(requestId) => setFilters((value) => ({ ...value, requestId: requestId.trim() }))} />
      </Space>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {data.summary.map((item) => (
          <Col xs={24} lg={12} key={item.requestType}>
            <Card title={item.requestType}>
              <Row gutter={[12, 12]}>
                <Col span={8}><Statistic title="Requests" value={item.requests} /></Col>
                <Col span={8}><Statistic title="OK" value={item.ok} /></Col>
                <Col span={8}><Statistic title="Errors" value={item.errors} /></Col>
                <Col span={8}><Statistic title="Timeout / cancelled" value={`${item.timeouts} / ${item.cancelled}`} /></Col>
                <Col span={8}><Statistic title="429" value={item.rateLimited} /></Col>
                <Col span={8}><Statistic title="Abstentions" value={item.abstentions} /></Col>
                <Col span={8}><Statistic title="Tokens" value={item.tokens} /></Col>
                <Col span={8}><Statistic title="Cost ($)" precision={4} value={item.cost} /></Col>
                <Col span={8}><Statistic title="Avg. sources" precision={2} value={item.averageSources} /></Col>
              </Row>
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="Grounded-answer cost" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={8}><Statistic title="Assistant provider cost ($)" precision={4} value={data.costEfficiency.totalAssistantProviderCost} /></Col>
          <Col span={8}><Statistic title="Successful grounded answers" value={data.costEfficiency.successfulGroundedAnswers} /></Col>
          <Col span={8}><Statistic title="Cost / successful grounded answer ($)" precision={6} value={data.costEfficiency.costPerSuccessfulGroundedAnswer ?? 0} suffix={data.costEfficiency.costPerSuccessfulGroundedAnswer == null ? "n/a" : ""} /></Col>
        </Row>
      </Card>

      <Card title="Stage latency (ms)" style={{ marginBottom: 16 }}>
        <Table pagination={false} rowKey="requestType" dataSource={data.latency} columns={[
          { title: "Type", dataIndex: "requestType" },
          { title: "Retrieval p50/p95", render: (_, row) => `${row.retrieval.p50} / ${row.retrieval.p95}` },
          { title: "First byte p50/p95", render: (_, row) => `${row.firstByte.p50} / ${row.firstByte.p95}` },
          { title: "Total p50/p95", render: (_, row) => `${row.total.p50} / ${row.total.p95}` },
        ]} />
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Dependency readiness">
            <Space wrap>
              {Object.entries(data.readiness).map(([name, value]) => <Tag color={statusColor(value)} key={name}>{name}: {value ? "ready" : "not ready"}</Tag>)}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Corpus release">
            {data.release ? <Descriptions size="small" column={1} items={[
              { key: "ingestion", label: "Ingestion", children: <Tag color={statusColor(data.release.ingestionStatus)}>{data.release.ingestionStatus}</Tag> },
              { key: "evaluation", label: "Evaluation", children: <Tag color={statusColor(data.release.evaluationStatus)}>{data.release.evaluationStatus}</Tag> },
              { key: "collection", label: "Collection", children: data.release.activeCollection || "—" },
              { key: "recall", label: "Recall@5", children: data.release.recallAt5 ?? "—" },
              { key: "abstention", label: "Abstention precision", children: data.release.abstentionPrecision ?? "—" },
            ]} /> : <Typography.Text type="secondary">No release state recorded</Typography.Text>}
          </Card>
        </Col>
      </Row>

      {data.detail && (
        <Card title={`Request ${data.detail.requestId}`} style={{ marginBottom: 16 }}>
          <Descriptions size="small" bordered column={2} items={Object.entries(data.detail).map(([key, value]) => ({ key, label: key, children: value == null ? "—" : String(value) }))} />
        </Card>
      )}

      <Card title="Requests, errors, and 429 over time">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="requests" fill="#1677ff" />
            <Bar dataKey="errors" fill="#ff4d4f" />
            <Bar dataKey="rateLimited" fill="#faad14" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
