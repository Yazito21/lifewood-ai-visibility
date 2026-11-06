"use client";

import { useState } from "react";
import { Pencil, RotateCcw } from "lucide-react";

/**
 * Text an admin can click to edit. Saving stores an override; "Reset to generated" removes it.
 * Viewers (and the printed PDF) see plain text.
 */
export function Editable({ path, value, edited, canEdit, onSave, multiline = true, placeholder = "—", as = "span" }: {
  path: string;
  value: string;
  edited: boolean;
  canEdit: boolean;
  onSave: (path: string, value: string | null) => void;
  multiline?: boolean;
  placeholder?: string;
  as?: "span" | "p";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const Tag = as;

  if (!canEdit) return <Tag>{value || placeholder}</Tag>;
  if (editing) {
    return <span className="report-edit-box print:hidden">
      {multiline
        ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} className="platform-input text-sm" aria-label="Edit text" autoFocus />
        : <input value={draft} onChange={(e) => setDraft(e.target.value)} className="platform-input text-sm" aria-label="Edit value" autoFocus />}
      <span className="report-edit-actions">
        <button type="button" className="platform-btn platform-btn-primary" onClick={() => { onSave(path, draft.trim()); setEditing(false); }}>Save</button>
        <button type="button" className="platform-btn" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</button>
      </span>
    </span>;
  }
  return <Tag className="report-editable">
    <span>{value || placeholder}</span>
    <button type="button" className="report-edit-button print:hidden" onClick={() => { setDraft(value); setEditing(true); }} aria-label="Edit"><Pencil size={12} /></button>
    {edited && <button type="button" className="report-edit-button print:hidden" onClick={() => onSave(path, null)} aria-label="Reset to generated" title="Reset to generated"><RotateCcw size={12} /></button>}
  </Tag>;
}
