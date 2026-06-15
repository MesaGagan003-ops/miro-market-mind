import { useState, useMemo, useEffect } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadPredictions, savePredictions, type PastPrediction } from "@/lib/accuracy";

interface CalibrationBucket {
  minConfidence: number;
  maxConfidence: number;
  total: number;
  correct: number;
  accuracy: number;
}

export function PredictionHistoryPanel() {
  const [tab, setTab] = useState<"history" | "calibration" | "export">("history");
  const [filterCoin, setFilterCoin] = useState<string>("");
  const [filterTimeframe, setFilterTimeframe] = useState<string>("");
  const [filterResult, setFilterResult] = useState<"all" | "correct" | "wrong">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<boolean | null>(null);

  // Use state + useEffect instead of useMemo(loadPredictions) to avoid SSR
  // hydration mismatches: localStorage is unavailable on the server, so the
  // server always renders with an empty list. The effect populates it after
  // mount, which matches the client's initial render.
  const [allPredictions, setAllPredictions] = useState<ReturnType<typeof loadPredictions>>([]);
  useEffect(() => {
    const list = loadPredictions();
    setAllPredictions(
      list.filter((p) => p.correct !== undefined).sort((a, b) => b.startTs - a.startTs),
    );
  }, []);

  const filteredPredictions = useMemo(() => {
    return allPredictions.filter((p) => {
      if (filterCoin && p.coinId !== filterCoin) return false;
      if (filterTimeframe && p.timeframeId !== filterTimeframe) return false;
      if (filterResult === "correct" && !p.correct) return false;
      if (filterResult === "wrong" && p.correct) return false;
      return true;
    });
  }, [allPredictions, filterCoin, filterTimeframe, filterResult]);

  const calibrationBuckets = useMemo(() => {
    const buckets: CalibrationBucket[] = [];
    for (let i = 0; i < 5; i++) {
      const minConf = i * 0.2;
      const maxConf = (i + 1) * 0.2;
      const preds = allPredictions.filter(
        (p) => p.hybridConfidence >= minConf && p.hybridConfidence < maxConf,
      );
      const correct = preds.filter((p) => p.correct).length;
      buckets.push({
        minConfidence: minConf,
        maxConfidence: maxConf,
        total: preds.length,
        correct,
        accuracy: preds.length > 0 ? correct / preds.length : 0,
      });
    }
    return buckets;
  }, [allPredictions]);

  const uniqueCoins = useMemo(
    () => [...new Set(allPredictions.map((p) => p.coinId))].sort(),
    [allPredictions],
  );
  const uniqueTimeframes = useMemo(
    () => [...new Set(allPredictions.map((p) => p.timeframeId))].sort(),
    [allPredictions],
  );

  const handleSaveCorrection = (id: string, corrected: boolean) => {
    const list = loadPredictions();
    const pred = list.find((p) => p.id === id);
    if (pred) {
      pred.correct = corrected;
      savePredictions(list);
      setEditingId(null);
      setEditValue(null);
      // Trigger re-render by updating state
      setTimeout(() => setEditingId(null), 0);
    }
  };

  const exportCSV = () => {
    const headers = [
      "ID",
      "Coin",
      "Timeframe",
      "Predicted Dir",
      "Confidence",
      "Start Price",
      "Predicted Price",
      "Resolved Price",
      "Actual Dir",
      "Correct",
      "% Move",
      "Start Timestamp",
      "Resolve Timestamp",
    ];
    const rows = filteredPredictions.map((p) => {
      const pctMove =
        p.resolvedPrice && p.startPrice
          ? (((p.resolvedPrice - p.startPrice) / p.startPrice) * 100).toFixed(2)
          : "N/A";
      return [
        p.id,
        p.coinId,
        p.timeframeId,
        p.predictedDirection,
        (p.hybridConfidence * 100).toFixed(0),
        p.startPrice.toFixed(6),
        p.predictedPrice.toFixed(6),
        p.resolvedPrice?.toFixed(6) ?? "N/A",
        p.actualDirection ?? "N/A",
        p.correct ? "YES" : "NO",
        pctMove,
        new Date(p.startTs).toISOString(),
        new Date(p.resolveTs).toISOString(),
      ];
    });

    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `predictions-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="panel p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-foreground">Prediction History & Calibration</h2>
        <span className="text-xs text-muted-foreground">{allPredictions.length} resolved</span>
      </div>

      {/* Tab buttons */}
      <div className="flex gap-2 border-b border-border">
        {(["history", "calibration", "export"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
              tab === t
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "history" ? "History" : t === "calibration" ? "Calibration" : "Export"}
          </button>
        ))}
      </div>

      {/* HISTORY TAB */}
      {tab === "history" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={filterCoin}
              onChange={(e) => setFilterCoin(e.target.value)}
              className="px-2 py-1 text-xs bg-card border border-border rounded text-foreground"
            >
              <option value="">All coins</option>
              {uniqueCoins.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filterTimeframe}
              onChange={(e) => setFilterTimeframe(e.target.value)}
              className="px-2 py-1 text-xs bg-card border border-border rounded text-foreground"
            >
              <option value="">All timeframes</option>
              {uniqueTimeframes.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
            <select
              value={filterResult}
              onChange={(e) => setFilterResult(e.target.value as any)}
              className="px-2 py-1 text-xs bg-card border border-border rounded text-foreground"
            >
              <option value="all">All results</option>
              <option value="correct">Correct only</option>
              <option value="wrong">Wrong only</option>
            </select>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto rounded border border-border/50 bg-card/30">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Coin</th>
                  <th className="px-2 py-2 text-left">TF</th>
                  <th className="px-2 py-2 text-left">Pred</th>
                  <th className="px-2 py-2 text-center">Conf</th>
                  <th className="px-2 py-2 text-left">Actual</th>
                  <th className="px-2 py-2 text-center">Result</th>
                  <th className="px-2 py-2 text-right">% Move</th>
                  <th className="px-2 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredPredictions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-2 py-3 text-center text-muted-foreground">
                      No predictions match filters
                    </td>
                  </tr>
                ) : (
                  filteredPredictions.map((p) => {
                    const pctMove =
                      p.resolvedPrice && p.startPrice
                        ? (((p.resolvedPrice - p.startPrice) / p.startPrice) * 100).toFixed(2)
                        : "N/A";
                    const isExpanded = expandedId === p.id;
                    const isEditing = editingId === p.id;

                    return (
                      <tr key={p.id} className="border-b border-border/30 hover:bg-card/50">
                        <td className="px-2 py-2 font-mono text-foreground">{p.coinId}</td>
                        <td className="px-2 py-2 text-muted-foreground">{p.timeframeId}</td>
                        <td className="px-2 py-2">
                          <span
                            style={{
                              color:
                                p.predictedDirection === "up"
                                  ? "var(--bull)"
                                  : p.predictedDirection === "down"
                                    ? "var(--bear)"
                                    : "var(--muted-foreground)",
                            }}
                          >
                            {p.predictedDirection === "up"
                              ? "▲"
                              : p.predictedDirection === "down"
                                ? "▼"
                                : "→"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center text-foreground">
                          {(p.hybridConfidence * 100).toFixed(0)}%
                        </td>
                        <td className="px-2 py-2">
                          <span
                            style={{
                              color:
                                p.actualDirection === "up"
                                  ? "var(--bull)"
                                  : p.actualDirection === "down"
                                    ? "var(--bear)"
                                    : "var(--muted-foreground)",
                            }}
                          >
                            {p.actualDirection === "up"
                              ? "▲"
                              : p.actualDirection === "down"
                                ? "▼"
                                : "→"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          {isEditing ? (
                            <select
                              value={editValue === true ? "correct" : "wrong"}
                              onChange={(e) => setEditValue(e.target.value === "correct")}
                              className="px-1 py-0 text-xs bg-card border border-border rounded"
                            >
                              <option value="correct">Correct</option>
                              <option value="wrong">Wrong</option>
                            </select>
                          ) : (
                            <Badge
                              className="cursor-pointer"
                              style={{
                                background: p.correct ? "var(--bull)" : "var(--bear)",
                                color: "white",
                              }}
                            >
                              {p.correct ? "✓" : "✗"}
                            </Badge>
                          )}
                        </td>
                        <td
                          className="px-2 py-2 text-right font-mono"
                          style={{
                            color:
                              parseFloat(pctMove) > 0
                                ? "var(--bull)"
                                : parseFloat(pctMove) < 0
                                  ? "var(--bear)"
                                  : "var(--muted-foreground)",
                          }}
                        >
                          {pctMove}%
                        </td>
                        <td className="px-2 py-2 text-center flex gap-1 justify-center">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveCorrection(p.id, editValue ?? false)}
                                className="text-primary hover:underline"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <X size={12} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setExpandedId(isExpanded ? null : p.id);
                                }}
                                className="text-primary hover:underline text-xs"
                              >
                                {isExpanded ? "Hide" : "View"}
                              </button>
                              <button
                                onClick={() => {
                                  setEditingId(p.id);
                                  setEditValue(p.correct ?? false);
                                }}
                                className="text-muted-foreground hover:text-foreground text-xs"
                              >
                                Edit
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Expanded row details */}
          {expandedId && (
            <div className="p-3 bg-card/50 rounded border border-border/50 text-xs space-y-2">
              {(() => {
                const p = filteredPredictions.find((pred) => pred.id === expandedId);
                if (!p) return null;
                return (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-muted-foreground">ID:</span>
                        <div className="font-mono">{p.id}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Confidence:</span>
                        <div className="font-mono">{(p.hybridConfidence * 100).toFixed(1)}%</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Start Price:</span>
                        <div className="font-mono">${p.startPrice.toFixed(6)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Predicted Price:</span>
                        <div className="font-mono">${p.predictedPrice.toFixed(6)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Resolved Price:</span>
                        <div className="font-mono">
                          ${p.resolvedPrice?.toFixed(6) ?? "N/A"}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Start Time:</span>
                        <div className="font-mono">
                          {new Date(p.startTs).toLocaleString("en-US", { timeZone: "UTC" })}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* CALIBRATION TAB */}
      {tab === "calibration" && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground mb-2">
            Bucket predictions by confidence and check if confidence matches actual accuracy.
          </div>
          <div className="space-y-2">
            {calibrationBuckets.map((b, i) => {
              const expectedAccuracy = (b.minConfidence + b.maxConfidence) / 2;
              const isCalibrated = Math.abs(b.accuracy - expectedAccuracy) < 0.1;
              return (
                <div key={i} className="p-2 rounded border border-border/50 bg-card/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold">
                      {(b.minConfidence * 100).toFixed(0)}–{(b.maxConfidence * 100).toFixed(0)}%
                    </span>
                    <Badge
                      style={{
                        background: isCalibrated ? "var(--bull)" : "var(--bear)",
                        color: "white",
                      }}
                    >
                      {(b.accuracy * 100).toFixed(0)}% ({b.correct}/{b.total})
                    </Badge>
                  </div>
                  <div className="h-2 bg-card rounded overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${b.accuracy * 100}%`,
                        background: isCalibrated ? "var(--bull)" : "var(--bear)",
                      }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Expected: {(expectedAccuracy * 100).toFixed(0)}% | Deviation:{" "}
                    {(Math.abs(b.accuracy - expectedAccuracy) * 100).toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-2 rounded bg-card/50 border border-border/50 text-xs text-muted-foreground space-y-1">
            <div className="font-semibold text-foreground">Calibration Summary</div>
            <div>
              Well-calibrated model: confidence thresholds match actual win rates in each bucket.
            </div>
            <div>
              If a bucket shows 80% confidence but only 50% accuracy, the model is overconfident in
              that range.
            </div>
          </div>
        </div>
      )}

      {/* EXPORT TAB */}
      {tab === "export" && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Export {filteredPredictions.length} predictions to CSV for external analysis.
          </div>
          <Button onClick={exportCSV} className="w-full flex items-center justify-center gap-2">
            <Download size={16} />
            Download CSV
          </Button>
          <div className="p-3 bg-card/30 rounded border border-border/50 text-xs text-muted-foreground space-y-1">
            <div className="font-semibold text-foreground">Included fields:</div>
            <div>
              ID, Coin, Timeframe, Predicted Direction, Confidence, Start Price, Predicted Price,
              Resolved Price, Actual Direction, Correct, % Move, Start Timestamp, Resolve
              Timestamp.
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
