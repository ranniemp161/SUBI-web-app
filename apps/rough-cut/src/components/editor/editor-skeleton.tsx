export function EditorSkeleton() {
  const block = "rounded-md bg-foreground/[0.06] motion-safe:animate-pulse";
  return (
    <div className="flex h-screen flex-col bg-background" aria-busy="true" aria-label="Loading editor">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-3 py-2">
        <div className="flex items-center gap-3">
          <div className={`h-8 w-28 ${block}`} />
          <div className={`h-8 w-40 ${block}`} />
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-8 w-16 ${block}`} />
          <div className={`h-8 w-20 ${block}`} />
          <div className={`h-8 w-24 ${block}`} />
        </div>
      </div>

      {/* Middle band */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-foreground/5 py-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`h-10 w-12 ${block}`} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
            <div className={`h-full w-full max-w-3xl ${block}`} />
          </div>
          <div className="flex items-center gap-3 border-t border-foreground/5 px-4 py-2.5">
            <div className={`h-5 w-28 ${block}`} />
            <div className="flex flex-1 items-center justify-center gap-2">
              <div className={`h-9 w-9 rounded-full ${block}`} />
              <div className={`h-10 w-10 rounded-full ${block}`} />
              <div className={`h-9 w-9 rounded-full ${block}`} />
            </div>
            <div className={`h-7 w-20 ${block}`} />
          </div>
        </div>
        <div className="w-[380px] shrink-0 space-y-3 border-l border-foreground/5 p-5">
          <div className={`h-7 w-32 ${block}`} />
          <div className={`h-9 w-full ${block}`} />
          <div className="space-y-2.5 pt-3">
            {[72, 88, 64, 80, 56, 84, 68, 76].map((w, i) => (
              <div key={i} className={`h-4 ${block}`} style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>

      {/* Timeline dock */}
      <div className="space-y-3 border-t border-foreground/10 p-4">
        <div className={`h-6 w-full ${block}`} />
        <div className={`h-12 w-full ${block}`} />
        <div className={`h-10 w-full ${block}`} />
      </div>
    </div>
  );
}
