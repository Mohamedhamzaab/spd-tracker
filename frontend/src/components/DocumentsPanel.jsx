// ---------------------------------------------------------------------------
//  DocumentsPanel — the shared attachments view for a communication, meeting
//  or QDRS record. Loose files are listed flat; files that were uploaded as
//  part of a folder are grouped into a clickable, expandable virtual folder
//  tree (rebuilt from each document's folder_path). Editors can upload (files
//  or whole folders), download all / a single folder as a zip, preview, and
//  remove. Reviewers get a read-only view.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { Loading, ErrorBanner, FileDrop, UploadProgress, fileSize, useToast } from './ui.jsx';
import DocViewer, { isPreviewable } from './DocViewer.jsx';

// Build a nested { name, path, folders[], files[] } tree from a flat document
// list. folder_path "Drawings/Civil" nests files two deep; a null folder_path
// keeps the file at the root.
function buildTree(docs) {
  const root = { name: '', path: '', folders: new Map(), files: [] };
  for (const d of docs) {
    const parts = (d.folder_path || '').split('/').filter(Boolean);
    let node = root;
    const acc = [];
    for (const part of parts) {
      acc.push(part);
      if (!node.folders.has(part)) {
        node.folders.set(part, { name: part, path: acc.join('/'), folders: new Map(), files: [] });
      }
      node = node.folders.get(part);
    }
    node.files.push(d);
  }
  return root;
}

// Total files under a node (including nested) — for the folder's count badge.
function countFiles(node) {
  let n = node.files.length;
  for (const child of node.folders.values()) n += countFiles(child);
  return n;
}

function sortedFolders(node) {
  return Array.from(node.folders.values()).sort((a, b) => a.name.localeCompare(b.name));
}
function sortedFiles(node) {
  return node.files.slice().sort((a, b) => (a.original_name || '').localeCompare(b.original_name || ''));
}

function FileRow({ doc, canEdit, onView, onDownload, onRemove }) {
  return (
    <div className="doc-chip">
      <span className="doc-file-icon" aria-hidden="true">📄</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="doc-name">{doc.original_name}</div>
        <div className="doc-meta">
          {fileSize(doc.size_bytes)}
          {doc.uploaded_by ? ' · ' + doc.uploaded_by : ''}
        </div>
      </div>
      {isPreviewable(doc) && (
        <button className="btn btn-sm" onClick={() => onView(doc)}>View</button>
      )}
      <button className="btn btn-sm" onClick={() => onDownload(doc)}>Download</button>
      {canEdit && (
        <button className="btn btn-sm btn-ghost" onClick={() => onRemove(doc)}>Remove</button>
      )}
    </div>
  );
}

function TreeNode({ node, depth, open, toggle, zipping, onZipFolder, ...fileProps }) {
  const folders = sortedFolders(node);
  const files = sortedFiles(node);
  return (
    <div>
      {folders.map((f) => {
        const isOpen = open.has(f.path);
        return (
          <div key={f.path} className="doc-folder">
            <div className="doc-folder-head" style={{ paddingLeft: depth * 16 }}>
              <button
                className="doc-folder-toggle"
                onClick={() => toggle(f.path)}
                aria-expanded={isOpen}
              >
                <span className="doc-folder-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span className="doc-folder-icon" aria-hidden="true">{isOpen ? '📂' : '📁'}</span>
                <span className="doc-folder-name">{f.name}</span>
                <span className="doc-folder-count">{countFiles(f)}</span>
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={zipping === f.path}
                onClick={() => onZipFolder(f)}
                title="Download this folder as a zip"
              >
                {zipping === f.path ? 'Preparing…' : 'Download folder'}
              </button>
            </div>
            {isOpen && (
              <div className="doc-folder-body">
                <TreeNode
                  node={f}
                  depth={depth + 1}
                  open={open}
                  toggle={toggle}
                  zipping={zipping}
                  onZipFolder={onZipFolder}
                  {...fileProps}
                />
              </div>
            )}
          </div>
        );
      })}
      <div style={{ paddingLeft: depth > 0 ? depth * 16 : 0 }}>
        {files.map((d) => <FileRow key={d.id} doc={d} {...fileProps} />)}
      </div>
    </div>
  );
}

export default function DocumentsPanel({ parentType, parentId, code, canEdit, onChange }) {
  const store = useStore();
  const editable = canEdit !== undefined ? canEdit : store.isEditor;
  const toast = useToast();
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [zipping, setZipping] = useState(null); // 'all' | folder path | null
  const [open, setOpen] = useState(() => new Set());

  function load() {
    api.docsList(parentType, parentId)
      .then((rows) => setDocs(rows || []))
      .catch((e) => setError(e.message));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [parentType, parentId]);

  const tree = useMemo(() => buildTree(docs || []), [docs]);
  const hasFolders = tree.folders.size > 0;

  function toggle(path) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function upload(items) {
    if (!items || !items.length) return;
    setUploading(true);
    setError('');
    setProgress({ done: 0, total: items.length });
    try {
      const { saved, skipped } = await api.uploadDocsBatched(
        parentType, parentId, items, (p) => setProgress(p)
      );
      let msg = saved.length === 1 ? '1 document uploaded' : `${saved.length} documents uploaded`;
      if (skipped.length) msg += ` · ${skipped.length} skipped`;
      toast(msg);
      load();
      if (onChange) onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function removeDoc(doc) {
    try {
      await api.deleteDoc(doc.id);
      toast('Document removed');
      load();
      if (onChange) onChange();
    } catch (e) {
      setError(e.message);
    }
  }

  async function downloadAll() {
    setZipping('all');
    setError('');
    try {
      await api.downloadDocsZip(parentType, parentId, `${code || parentType}-documents.zip`);
    } catch (e) {
      setError(e.message);
    } finally {
      setZipping(null);
    }
  }

  async function downloadFolder(folder) {
    setZipping(folder.path);
    setError('');
    try {
      await api.downloadDocsZip(parentType, parentId, `${folder.name}-documents.zip`, folder.path);
    } catch (e) {
      setError(e.message);
    } finally {
      setZipping(null);
    }
  }

  if (!docs) return <Loading label="Loading documents" />;

  const fileProps = {
    canEdit: editable,
    onView: setViewerDoc,
    onDownload: (d) => api.downloadDoc(d.id, d.original_name),
    onRemove: removeDoc,
  };

  return (
    <div>
      <ErrorBanner message={error} />

      {docs.length >= 2 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button className="btn btn-sm" disabled={zipping === 'all'} onClick={downloadAll}>
            {zipping === 'all' ? 'Preparing…' : 'Download all'}
          </button>
        </div>
      )}

      {docs.length === 0 && (
        <div className="section-note" style={{ marginBottom: 10 }}>
          No documents attached yet.
        </div>
      )}

      {docs.length > 0 && (
        <div className={hasFolders ? 'doc-tree' : ''}>
          <TreeNode
            node={tree}
            depth={0}
            open={open}
            toggle={toggle}
            zipping={zipping}
            onZipFolder={downloadFolder}
            {...fileProps}
          />
        </div>
      )}

      {editable && (
        <div style={{ marginTop: 10 }}>
          {uploading && (
            <UploadProgress
              pct={progress?.pct ?? 0}
              done={progress?.done ?? 0}
              total={progress?.total ?? 0}
            />
          )}
          <FileDrop
            onFiles={upload}
            uploading={uploading}
            label="+ Upload documents"
            busyLabel={progress ? `Uploading ${progress.done}/${progress.total} (${progress.pct ?? 0}%)…` : 'Uploading…'}
          />
        </div>
      )}

      {viewerDoc && <DocViewer doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </div>
  );
}
