import { useRef } from "react";
import type { ViaDefinition } from "../types/via";
import { definitionKey } from "../lib/tauriSettings";

interface LibraryPageProps {
  library: ViaDefinition[];
  examples: { label: string; definition: unknown }[];
  onImport: (def: ViaDefinition) => void;
  onRemove: (def: ViaDefinition) => void;
  onOpen: (def: ViaDefinition) => void;
  parseDefinition: (json: unknown) => ViaDefinition;
}

export default function LibraryPage({
  library,
  examples,
  onImport,
  onRemove,
  onOpen,
  parseDefinition,
}: LibraryPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      onImport(parseDefinition(JSON.parse(text)));
    } catch {
      // silently ignore — a malformed file just won't get added
    }
  };

  const libraryKeys = new Set(library.map(definitionKey));

  return (
    <div className="menu-panel library-page">
      <section className="menu-group">
        <h3 className="menu-group__title">Keyboard Library</h3>
        <p className="rgb-stream__blurb">
          Every definition here is matched automatically against any keyboard that connects — by
          vendor/product ID, not by which one you happen to have loaded right now. Add every board
          you own once, and whichever one is plugged in just works.
        </p>

        <div className="rgb-stream__toolbar">
          <button className="pill-btn" type="button" onClick={() => fileInputRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          {examples.map((ex) => {
            const def = ex.definition as ViaDefinition;
            const already = libraryKeys.has(definitionKey(def));
            return (
              <button
                key={ex.label}
                className="pill-btn"
                type="button"
                disabled={already}
                onClick={() => onImport(parseDefinition(ex.definition))}
              >
                {already ? `${ex.label} (added)` : `Add ${ex.label}`}
              </button>
            );
          })}
        </div>
      </section>

      <section className="menu-group">
        <h3 className="menu-group__title">
          Library ({library.length} {library.length === 1 ? "board" : "boards"})
        </h3>
        {library.length === 0 ? (
          <p className="rgb-stream__blurb">Nothing here yet — import a definition JSON above.</p>
        ) : (
          <div className="library-list">
            {library.map((def) => (
              <div key={definitionKey(def)} className="library-row">
                <div className="library-row__info">
                  <span className="library-row__name">{def.name}</span>
                  <span className="menu-control__raw">
                    {def.vendorId}:{def.productId} · {def.matrix.rows}×{def.matrix.cols}
                  </span>
                </div>
                <div className="rgb-stream__toolbar rgb-stream__toolbar--tight">
                  <button className="pill-btn" type="button" onClick={() => onOpen(def)}>
                    Open
                  </button>
                  <button className="pill-btn pill-btn--danger" type="button" onClick={() => onRemove(def)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
