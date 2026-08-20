import { useEffect, useState } from "react";
import AdminApp from "@/components/admin/AdminApp";

export default function AdminPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <AdminApp />;
}
