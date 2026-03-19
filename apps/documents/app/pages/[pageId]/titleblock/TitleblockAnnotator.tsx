'use client';

import React, {
  MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

interface NormalisedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type FieldKey = 'drawing_number' | 'drawing_title' | 'revision' | 'other';

interface FieldArea {
  field: FieldKey;
  x_rel: number;
  y_rel: number;
  width_rel: number;
  height_rel: number;
}

interface TitleblockAnnotatorProps {
  pageId: string;
  imageUrl: string;
  initialTitleblockRectNorm: NormalisedRect | null;
  initialAreas: FieldArea[];
}

interface NormalisedPoint {
  x: number;
  y: number;
}

interface FieldAreaLocal {
  x_rel: number;
  y_rel: number;
  width_rel: number;
  height_rel: number;
}

interface FieldAreaMap {
  drawing_number: FieldAreaLocal | null;
  drawing_title: FieldAreaLocal | null;
  revision: FieldAreaLocal | null;
  other: FieldAreaLocal | null;
}

type ActiveTool = 'titleblock' | FieldKey | null;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function computeNormRect(
  start: NormalisedPoint | null,
  current: NormalisedPoint | null,
): NormalisedRect | null {
  if (!start || !current) {
    return null;
  }

  const x1 = clamp01(start.x);
  const y1 = clamp01(start.y);
  const x2 = clamp01(current.x);
  const y2 = clamp01(current.y);

  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { left, top, width, height };
}

function buildInitialFieldAreas(areas: FieldArea[]): FieldAreaMap {
  const result: FieldAreaMap = {
    drawing_number: null,
    drawing_title: null,
    revision: null,
    other: null,
  };

  for (const a of areas) {
    const local: FieldAreaLocal = {
      x_rel: a.x_rel,
      y_rel: a.y_rel,
      width_rel: a.width_rel,
      height_rel: a.height_rel,
    };
    if (a.field === 'drawing_number') {
      result.drawing_number = local;
    } else if (a.field === 'drawing_title') {
      result.drawing_title = local;
    } else if (a.field === 'revision') {
      result.revision = local;
    } else if (a.field === 'other') {
      result.other = local;
    }
  }

  return result;
}

function isFieldTool(tool: ActiveTool): tool is FieldKey {
  return (
    tool === 'drawing_number' ||
    tool === 'drawing_title' ||
    tool === 'revision' ||
    tool === 'other'
  );
}

export default function TitleblockAnnotator(
  props: TitleblockAnnotatorProps,
) {
  const { pageId, imageUrl, initialTitleblockRectNorm, initialAreas } =
    props;

  // Full-page overlay (for title-block selection)
  const pageOverlayRef = useRef<HTMLDivElement | null>(null);

  // Zoomed title-block view (cropped canvas + overlay)
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoomOverlayRef = useRef<HTMLDivElement | null>(null);

  // Title-block rect normalised to full page (0–1)
  const [titleblock, setTitleblock] = useState<NormalisedRect | null>(
    initialTitleblockRectNorm,
  );

  // Draft selection on the page (before confirm)
  const [pageDraftStart, setPageDraftStart] =
    useState<NormalisedPoint | null>(null);
  const [pageDraftCurrent, setPageDraftCurrent] =
    useState<NormalisedPoint | null>(null);
  const [draggingPage, setDraggingPage] = useState(false);

  // Draft selection on the zoomed title-block (for field areas)
  const [zoomDraftStart, setZoomDraftStart] =
    useState<NormalisedPoint | null>(null);
  const [zoomDraftCurrent, setZoomDraftCurrent] =
    useState<NormalisedPoint | null>(null);
  const [draggingZoom, setDraggingZoom] = useState(false);

  // Areas per field, normalised to title-block (0–1)
  const [fieldAreas, setFieldAreas] = useState<FieldAreaMap>(() =>
    buildInitialFieldAreas(initialAreas),
  );

  const [activeTool, setActiveTool] = useState<ActiveTool>(() =>
    initialTitleblockRectNorm ? 'drawing_number' : 'titleblock',
  );

  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const busy = saving || clearing;
  const titleblockDefined = !!titleblock;

  const pageDraftRect = computeNormRect(pageDraftStart, pageDraftCurrent);
  const zoomDraftRect = computeNormRect(zoomDraftStart, zoomDraftCurrent);

  // Draw zoomed title-block into canvas whenever title-block or image changes.
  useEffect(() => {
    const canvas = zoomCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!titleblockDefined || !titleblock) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const img = new Image();
    img.src = imageUrl;

    img.onload = () => {
      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;
      if (natW <= 0 || natH <= 0) {
        return;
      }

      const sx = titleblock.left * natW;
      const sy = titleblock.top * natH;
      const sWidth = titleblock.width * natW;
      const sHeight = titleblock.height * natH;
      if (sWidth <= 0 || sHeight <= 0) {
        return;
      }

      const maxWidth = 800;
      const scale = maxWidth / sWidth;
      const targetWidth = maxWidth;
      const targetHeight = Math.max(120, sHeight * scale);

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(
        img,
        sx,
        sy,
        sWidth,
        sHeight,
        0,
        0,
        targetWidth,
        targetHeight,
      );
    };
  }, [imageUrl, titleblockDefined, titleblock]);

  // Helpers to map mouse to normalised coordinates in each overlay
  function getNormalisedPointInPage(
    event: ReactMouseEvent<HTMLDivElement, MouseEvent>,
  ): NormalisedPoint | null {
    const overlay = pageOverlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return { x: clamp01(x), y: clamp01(y) };
  }

  function getNormalisedPointInZoom(
    event: ReactMouseEvent<HTMLDivElement, MouseEvent>,
  ): NormalisedPoint | null {
    const overlay = zoomOverlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return { x: clamp01(x), y: clamp01(y) };
  }

  // Page overlay – title-block selection only
  function handlePageMouseDown(
    event: ReactMouseEvent<HTMLDivElement, MouseEvent>,
  ): void {
    if (busy) return;
    if (activeTool !== 'titleblock') return;

    event.preventDefault();
    const p = getNormalisedPointInPage(event);
    if (!p) return;

    setPageDraftStart(p);
    setPageDraftCurrent(p);
    setDraggingPage(true);
    setStatusMessage(null);
  }

  function handlePageMouseMove(
    event: ReactMouseEvent<HTMLDivElement, MouseEvent>,
  ): void {
    if (!draggingPage) return;
    if (activeTool !== 'titleblock') return;

    const p = getNormalisedPointInPage(event);
    if (!p) return;

    setPageDraftCurrent(p);
  }

  function handlePageMouseUp(): void {
    if (!draggingPage) return;
    setDraggingPage(false);
    // We keep the draft rect; user presses Confirm to commit.
  }

  function handlePageMouseLeave(): void {
    if (!draggingPage) return;
    setDraggingPage(false);
  }

  // Zoom overlay – field area selection
  function handleZoomMouseDown(
    event: ReactMouseEvent<HTMLDivElement, MouseEvent>,
  ): void {
    if (busy) return;
    if (!titleblockDefined || !titleblock) return;
    if (!isFieldTool(activeTool)) return;

    event.preventDefault();
    const p = getNormalisedPointInZoom(event);
    if (!p) return;

    setZoomDraftStart(p);
    setZoomDraftCurrent(p);
    setDraggingZoom(true);
    setStatusMessage(null);
  }

  function handleZoomMouseMove(
    event: ReactMouseEvent<HTMLDivElement, MouseEvent>,
  ): void {
    if (!draggingZoom) return;
    if (!isFieldTool(activeTool)) return;

    const p = getNormalisedPointInZoom(event);
    if (!p) return;

    setZoomDraftCurrent(p);
  }

  function commitZoomSelection(): void {
    if (!isFieldTool(activeTool)) return;
    const rect = computeNormRect(zoomDraftStart, zoomDraftCurrent);
    if (!rect) {
      setStatusMessage(
        'No selection defined. Click and drag a rectangle in the zoomed title-block.',
      );
      return;
    }

    const { left, top, width, height } = rect;
    if (width <= 0 || height <= 0) {
      setStatusMessage('Selection is too small inside the title-block.');
      return;
    }

    setFieldAreas((prev) => ({
      ...prev,
      [activeTool]: {
        x_rel: clamp01(left),
        y_rel: clamp01(top),
        width_rel: clamp01(width),
        height_rel: clamp01(height),
      },
    }));

    setStatusMessage(
      `Set ${activeTool} area (${left.toFixed(2)}, ${top.toFixed(
        2,
      )}, ${width.toFixed(2)} × ${height.toFixed(2)}) in the title-block.`,
    );
  }

  function handleZoomMouseUp(): void {
    if (!draggingZoom) return;
    setDraggingZoom(false);
    if (isFieldTool(activeTool)) {
      commitZoomSelection();
    }
  }

  function handleZoomMouseLeave(): void {
    if (!draggingZoom) return;
    setDraggingZoom(false);
    if (isFieldTool(activeTool)) {
      commitZoomSelection();
    }
  }

  // Clicks are no-op now; we use drag rectangles.
  function handleOverlayClick(
    _event: ReactMouseEvent<HTMLDivElement, MouseEvent>,
  ): void {
    // no-op
  }

  function handleConfirmTitleblock(): void {
    setStatusMessage(null);

    if (titleblockDefined && titleblock) {
      setStatusMessage('Title-block is already confirmed. Clear first to redefine.');
      return;
    }

    const rect = computeNormRect(pageDraftStart, pageDraftCurrent);
    if (!rect) {
      setStatusMessage(
        'No selection defined. Click and drag a rectangle around the title-block, then click Confirm title-block.',
      );
      return;
    }

    if (rect.width < 0.02 || rect.height < 0.02) {
      setStatusMessage(
        'Selection is very small. Please drag a larger title-block area.',
      );
      return;
    }

    setTitleblock(rect);
    setPageDraftStart(null);
    setPageDraftCurrent(null);
    setActiveTool('drawing_number');
    setStatusMessage(
      'Title-block set. Now use the zoomed view to mark drawing number, title, and revision.',
    );
  }

  async function handleSaveAll(): Promise<void> {
    setStatusMessage(null);

    if (!titleblockDefined || !titleblock) {
      setStatusMessage(
        'Title-block is not defined. Set the title-block before saving.',
      );
      return;
    }

    const areasToSave: FieldArea[] = [];
    const keys: FieldKey[] = [
      'drawing_number',
      'drawing_title',
      'revision',
      'other',
    ];

    for (const key of keys) {
      const area = fieldAreas[key];
      if (!area) continue;
      areasToSave.push({
        field: key,
        x_rel: area.x_rel,
        y_rel: area.y_rel,
        width_rel: area.width_rel,
        height_rel: area.height_rel,
      });
    }

    setSaving(true);

    try {
      const response = await fetch('/documents/api/titleblock-annotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId,
          titleblock: {
            x: titleblock.left,
            y: titleblock.top,
            width: titleblock.width,
            height: titleblock.height,
          },
          areas: areasToSave,
        }),
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || !json || json.ok !== true) {
        const message =
          (json && json.error) ||
          `Save failed with status ${response.status}`;
        setStatusMessage(message);
      } else {
        setStatusMessage('Title-block and field areas saved (status set to Tagged).');
      }
    } catch {
      setStatusMessage('Network or server error while saving.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear(): Promise<void> {
    setStatusMessage(null);

    const nothingToClear =
      !titleblockDefined &&
      !fieldAreas.drawing_number &&
      !fieldAreas.drawing_title &&
      !fieldAreas.revision &&
      !fieldAreas.other;

    if (nothingToClear) {
      setStatusMessage('Nothing to clear for this page.');
      return;
    }

    const confirmed = window.confirm(
      'Clear all title-block and field annotations for this page?',
    );
    if (!confirmed) {
      return;
    }

    setClearing(true);

    try {
      const response = await fetch('/documents/api/titleblock-annotate', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId }),
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || !json || json.ok !== true) {
        const message =
          (json && json.error) ||
          `Clear failed with status ${response.status}`;
        setStatusMessage(message);
      } else {
        setTitleblock(null);
        setPageDraftStart(null);
        setPageDraftCurrent(null);
        setZoomDraftStart(null);
        setZoomDraftCurrent(null);
        setFieldAreas({
          drawing_number: null,
          drawing_title: null,
          revision: null,
          other: null,
        });
        setActiveTool('titleblock');
        setStatusMessage('All annotations cleared for this page.');
      }
    } catch {
      setStatusMessage('Network or server error while clearing.');
    } finally {
      setClearing(false);
    }
  }

  function renderPageOverlayRects() {
    const elements: React.ReactNode[] = [];

    if (titleblockDefined && titleblock) {
      elements.push(
        <div
          key="titleblock"
          style={{
            position: 'absolute',
            left: `${titleblock.left * 100}%`,
            top: `${titleblock.top * 100}%`,
            width: `${titleblock.width * 100}%`,
            height: `${titleblock.height * 100}%`,
            border: '2px solid #22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.12)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />,
      );
    } else if (pageDraftRect) {
      elements.push(
        <div
          key="draft"
          style={{
            position: 'absolute',
            left: `${pageDraftRect.left * 100}%`,
            top: `${pageDraftRect.top * 100}%`,
            width: `${pageDraftRect.width * 100}%`,
            height: `${pageDraftRect.height * 100}%`,
            border: '2px solid #ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.18)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />,
      );
    }

    return elements;
  }

  function renderZoomOverlayRects() {
    if (!titleblockDefined || !titleblock) {
      return null;
    }

    const elements: React.ReactNode[] = [];

    const entries: [FieldKey, FieldAreaLocal | null][] = [
      ['drawing_number', fieldAreas.drawing_number],
      ['drawing_title', fieldAreas.drawing_title],
      ['revision', fieldAreas.revision],
      ['other', fieldAreas.other],
    ];

    for (const [field, area] of entries) {
      if (!area) continue;

      const left = area.x_rel;
      const top = area.y_rel;
      const width = area.width_rel;
      const height = area.height_rel;

      let borderColor = '#1d4ed8';
      let backgroundColor = 'rgba(37, 99, 235, 0.25)';
      let label = 'O';

      if (field === 'drawing_number') {
        borderColor = '#0f766e';
        backgroundColor = 'rgba(20, 184, 166, 0.25)';
        label = 'D';
      } else if (field === 'drawing_title') {
        borderColor = '#4f46e5';
        backgroundColor = 'rgba(99, 102, 241, 0.25)';
        label = 'T';
      } else if (field === 'revision') {
        borderColor = '#b45309';
        backgroundColor = 'rgba(249, 115, 22, 0.25)';
        label = 'R';
      } else if (field === 'other') {
        borderColor = '#4b5563';
        backgroundColor = 'rgba(156, 163, 175, 0.25)';
        label = 'O';
      }

      elements.push(
        <div
          key={`area-${field}`}
          style={{
            position: 'absolute',
            left: `${left * 100}%`,
            top: `${top * 100}%`,
            width: `${width * 100}%`,
            height: `${height * 100}%`,
            border: `2px solid ${borderColor}`,
            backgroundColor,
            boxSizing: 'border-box',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            fontSize: '0.65rem',
            color: '#111827',
            padding: 2,
          }}
        >
          <span
            style={{
              backgroundColor: borderColor,
              color: '#ffffff',
              borderRadius: 9999,
              padding: '0 4px',
              lineHeight: 1.2,
            }}
          >
            {label}
          </span>
        </div>,
      );
    }

    if (zoomDraftRect) {
      elements.push(
        <div
          key="zoom-draft"
          style={{
            position: 'absolute',
            left: `${zoomDraftRect.left * 100}%`,
            top: `${zoomDraftRect.top * 100}%`,
            width: `${zoomDraftRect.width * 100}%`,
            height: `${zoomDraftRect.height * 100}%`,
            border: '2px solid #ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.18)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />,
      );
    }

    return elements;
  }

  const titleblockButtonDisabled = titleblockDefined || busy;
  const fieldButtonsDisabled = !titleblockDefined || busy;
  const hasPageDraft = !!pageDraftRect;
  const confirmDisabled = titleblockDefined || busy || !hasPageDraft;
  const saveDisabled = !titleblockDefined || busy;

  return (
    <div>
      <div
        style={{
          marginBottom: '0.5rem',
          fontSize: '0.85rem',
          color: '#475569',
        }}
      >
        <p style={{ marginBottom: '0.25rem' }}>
          1. With <strong>Title-block</strong> selected, click and drag a
          rectangle around the title-block on the full page.
        </p>
        <p style={{ marginBottom: '0.25rem' }}>
          2. Click <strong>Confirm title-block</strong>. The green box is
          fixed and the zoomed title-block view appears below.
        </p>
        <p style={{ marginBottom: '0.25rem' }}>
          3. In the zoomed view, select a field (Drawing number, Drawing
          title, Revision, Other) and click-drag a rectangle around the text.
          Re-dragging replaces the previous area for that field.
        </p>
        <p style={{ marginBottom: '0.25rem' }}>
          4. When you are happy, click <strong>Save</strong> to write all
          annotations to Supabase, or <strong>Clear</strong> to wipe them.
        </p>
      </div>

      {/* Full-page view (title-block only) */}
      <div
        style={{
          position: 'relative',
          display: 'inline-block',
          border: '1px solid #e5e7eb',
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: '0.75rem',
          maxWidth: '100%',
        }}
      >
        <img
          src={imageUrl}
          alt="Page preview for title-block selection"
          style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
        />
        <div
          ref={pageOverlayRef}
          onMouseDown={handlePageMouseDown}
          onMouseMove={handlePageMouseMove}
          onMouseUp={handlePageMouseUp}
          onMouseLeave={handlePageMouseLeave}
          onClick={handleOverlayClick}
          style={{
            position: 'absolute',
            inset: 0,
            cursor:
              busy || activeTool !== 'titleblock'
                ? 'default'
                : 'crosshair',
          }}
        >
          {renderPageOverlayRects()}
        </div>
      </div>

      {/* Zoomed title-block view for field areas */}
      {titleblockDefined && titleblock && (
        <div
          style={{
            marginBottom: '0.75rem',
            padding: '0.5rem',
            borderRadius: 4,
            border: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
          }}
        >
          <div
            style={{
              marginBottom: '0.3rem',
              fontSize: '0.85rem',
              color: '#475569',
            }}
          >
            Zoomed title-block (use this to mark drawing number, title, and
            revision)
          </div>
          <div
            style={{
              position: 'relative',
              display: 'inline-block',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <canvas
              ref={zoomCanvasRef}
              style={{
                display: 'block',
              }}
            />
            <div
              ref={zoomOverlayRef}
              onMouseDown={handleZoomMouseDown}
              onMouseMove={handleZoomMouseMove}
              onMouseUp={handleZoomMouseUp}
              onMouseLeave={handleZoomMouseLeave}
              onClick={handleOverlayClick}
              style={{
                position: 'absolute',
                inset: 0,
                cursor:
                  busy || !isFieldTool(activeTool)
                    ? 'default'
                    : 'crosshair',
              }}
            >
              {renderZoomOverlayRects()}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.5rem',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTool('titleblock')}
          disabled={titleblockButtonDisabled}
          style={{
            padding: '0.3rem 0.7rem',
            borderRadius: 4,
            border: '1px solid #16a34a',
            backgroundColor:
              !titleblockButtonDisabled && activeTool === 'titleblock'
                ? '#bbf7d0'
                : '#22c55e',
            opacity: titleblockButtonDisabled ? 0.7 : 1,
            color: '#ffffff',
            fontSize: '0.85rem',
            cursor: titleblockButtonDisabled ? 'default' : 'pointer',
          }}
        >
          Title-block
        </button>

        <button
          type="button"
          onClick={() => setActiveTool('drawing_number')}
          disabled={fieldButtonsDisabled}
          style={{
            padding: '0.3rem 0.7rem',
            borderRadius: 4,
            border: '1px solid #0f766e',
            backgroundColor:
              !fieldButtonsDisabled && activeTool === 'drawing_number'
                ? '#99f6e4'
                : '#14b8a6',
            color: '#ffffff',
            fontSize: '0.85rem',
            cursor: fieldButtonsDisabled ? 'default' : 'pointer',
          }}
        >
          Drawing number
        </button>

        <button
          type="button"
          onClick={() => setActiveTool('drawing_title')}
          disabled={fieldButtonsDisabled}
          style={{
            padding: '0.3rem 0.7rem',
            borderRadius: 4,
            border: '1px solid #4f46e5',
            backgroundColor:
              !fieldButtonsDisabled && activeTool === 'drawing_title'
                ? '#c7d2fe'
                : '#6366f1',
            color: '#ffffff',
            fontSize: '0.85rem',
            cursor: fieldButtonsDisabled ? 'default' : 'pointer',
          }}
        >
          Drawing title
        </button>

        <button
          type="button"
          onClick={() => setActiveTool('revision')}
          disabled={fieldButtonsDisabled}
          style={{
            padding: '0.3rem 0.7rem',
            borderRadius: 4,
            border: '1px solid #b45309',
            backgroundColor:
              !fieldButtonsDisabled && activeTool === 'revision'
                ? '#fed7aa'
                : '#f97316',
            color: '#ffffff',
            fontSize: '0.85rem',
            cursor: fieldButtonsDisabled ? 'default' : 'pointer',
          }}
        >
          Revision
        </button>

        <button
          type="button"
          onClick={() => setActiveTool('other')}
          disabled={fieldButtonsDisabled}
          style={{
            padding: '0.3rem 0.7rem',
            borderRadius: 4,
            border: '1px solid #6b7280',
            backgroundColor:
              !fieldButtonsDisabled && activeTool === 'other'
                ? '#e5e7eb'
                : '#9ca3af',
            color: '#111827',
            fontSize: '0.85rem',
            cursor: fieldButtonsDisabled ? 'default' : 'pointer',
          }}
        >
          Other
        </button>

        <button
          type="button"
          onClick={handleConfirmTitleblock}
          disabled={confirmDisabled}
          style={{
            padding: '0.3rem 0.7rem',
            borderRadius: 4,
            border: '1px solid #15803d',
            backgroundColor: confirmDisabled ? '#bbf7d0' : '#16a34a',
            color: '#ffffff',
            fontSize: '0.85rem',
            cursor: confirmDisabled ? 'default' : 'pointer',
          }}
        >
          Confirm title-block
        </button>

        <button
          type="button"
          onClick={handleClear}
          disabled={busy}
          style={{
            padding: '0.3rem 0.7rem',
            borderRadius: 4,
            border: '1px solid #b91c1c',
            backgroundColor: busy ? '#fecaca' : '#ef4444',
            color: '#ffffff',
            fontSize: '0.85rem',
            cursor: busy ? 'default' : 'pointer',
            marginLeft: 'auto',
          }}
        >
          {clearing ? 'Clearing…' : 'Clear'}
        </button>

        <button
          type="button"
          onClick={handleSaveAll}
          disabled={saveDisabled}
          style={{
            padding: '0.3rem 0.9rem',
            borderRadius: 4,
            border: '1px solid #1d4ed8',
            backgroundColor: saveDisabled ? '#bfdbfe' : '#2563eb',
            color: '#ffffff',
            fontSize: '0.85rem',
            cursor: saveDisabled ? 'default' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {statusMessage && (
        <p
          style={{
            fontSize: '0.8rem',
            color: '#374151',
          }}
        >
          {statusMessage}
        </p>
      )}
    </div>
  );
}