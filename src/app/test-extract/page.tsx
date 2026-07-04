'use client';

import { useEffect, useState } from "react";
import { extractAudioForTranscription } from "@/lib/audio-extract";

export default function TestExtractPage() {
  const [status, setStatus] = useState<string>("Loading...");
  const [result, setResult] = useState<any>(null);
  const [progressLog, setProgressLog] = useState<number[]>([]);

  useEffect(() => {
    async function runTest() {
      try {
        setStatus("Fetching sample.mp4...");
        const res = await fetch("/sample.mp4");
        const blob = await res.blob();
        const file = new File([blob], "sample.mp4", { type: "video/mp4" });

        setStatus("Extracting audio...");
        const start = performance.now();
        const extraction = await extractAudioForTranscription(file, (p) => {
          setProgressLog((prev) => [...prev, p]);
        });
        const end = performance.now();

        setStatus("Done!");
        setResult({
          kind: extraction.kind,
          mimeType: extraction.kind === "audio" ? extraction.mimeType : null,
          originalSize: file.size,
          extractedSize: extraction.kind === "audio" ? extraction.blob.size : null,
          durationMs: end - start,
        });
      } catch (err: any) {
        setStatus("Error: " + err.message);
      }
    }
    runTest();
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", background: "#111", color: "#eee", minHeight: "100vh" }}>
      <h1>Audio Extraction Test Surface</h1>
      <p>Status: <strong>{status}</strong></p>
      {result && (
        <div style={{ background: "#222", padding: 15, borderRadius: 8, marginTop: 10 }}>
          <h2>Result</h2>
          <p>Kind: {result.kind}</p>
          <p>MimeType: {result.mimeType}</p>
          <p>Original Size: {(result.originalSize / 1024).toFixed(2)} KB</p>
          <p>Extracted Size: {result.extractedSize ? (result.extractedSize / 1024).toFixed(2) + " KB" : "N/A"}</p>
          <p>Ratio: {result.extractedSize ? (result.extractedSize / result.originalSize * 100).toFixed(2) + "%" : "N/A"}</p>
          <p>Duration: {result.durationMs.toFixed(2)} ms</p>
        </div>
      )}
      <div style={{ marginTop: 20 }}>
        <h3>Progress Log</h3>
        <pre>{JSON.stringify(progressLog, null, 2)}</pre>
      </div>
    </div>
  );
}
