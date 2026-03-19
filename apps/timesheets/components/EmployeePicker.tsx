"use client";

import { useEffect, useState } from "react";
import { supabase } from "@platform/supabase";
import type { Employee } from "@/lib/types";

type Props = {
  selected: Employee | null;
  onSelect: (emp: Employee) => void;
};

export function EmployeePicker({ selected, onSelect }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEmployees = async () => {
    const { data, error: err } = await supabase
      .from("employees")
      .select("id, first_name, last_name, active")
      .eq("active", true)
      .order("last_name")
      .order("first_name");
    if (err) {
      console.error("Failed to load employees", err);
      return;
    }
    setEmployees(data ?? []);
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  const handleAdd = async () => {
    if (!newFirst.trim() || !newLast.trim()) return;
    setSaving(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("employees")
      .insert({
        first_name: newFirst.trim(),
        last_name: newLast.trim(),
      })
      .select()
      .single();

    setSaving(false);

    if (err) {
      setError(err.message);
      return;
    }

    setNewFirst("");
    setNewLast("");
    setShowAdd(false);
    await loadEmployees();
    if (data) onSelect(data);
  };

  const handleDeactivate = async () => {
    if (!selected) return;
    const confirmed = window.confirm(
      `Deactivate ${selected.first_name} ${selected.last_name}?`
    );
    if (!confirmed) return;

    await supabase
      .from("employees")
      .update({ active: false })
      .eq("id", selected.id);

    onSelect(null as unknown as Employee);
    await loadEmployees();
  };

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium">Employee:</label>
      <select
        className="rounded border px-3 py-1.5 text-sm min-w-50"
        value={selected?.id ?? ""}
        onChange={(e) => {
          const emp = employees.find((x) => x.id === e.target.value);
          if (emp) onSelect(emp);
        }}
      >
        <option value="">Select employee...</option>
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {emp.last_name}, {emp.first_name}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => setShowAdd(!showAdd)}
        className="rounded border px-2.5 py-1 text-lg font-bold hover:bg-gray-100 cursor-pointer"
        title="Add employee"
      >
        +
      </button>

      {selected && (
        <button
          type="button"
          onClick={handleDeactivate}
          className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 cursor-pointer"
          title="Deactivate employee"
        >
          Deactivate
        </button>
      )}

      {showAdd && (
        <div className="flex items-center gap-2 ml-2 border-l pl-3">
          <input
            placeholder="First name"
            value={newFirst}
            onChange={(e) => setNewFirst(e.target.value)}
            className="rounded border px-2 py-1 text-sm w-28"
            autoFocus
          />
          <input
            placeholder="Last name"
            value={newLast}
            onChange={(e) => setNewLast(e.target.value)}
            className="rounded border px-2 py-1 text-sm w-28"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving}
            className="rounded bg-blue-600 text-white px-3 py-1 text-sm hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
          >
            {saving ? "Saving..." : "Add"}
          </button>
          {error && <span className="text-red-600 text-xs">{error}</span>}
        </div>
      )}
    </div>
  );
}
