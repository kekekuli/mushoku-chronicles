import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteImages } from "../hooks/useInfiniteImages";

const COLUMN_WIDTH = 200;
const GAP = 12;

export default function ImageWaterfall() {
  const {
    images,
    isFetching,
    isError,
    hasMore,
    loadMore,
  } = useInfiniteImages();

  const sentinelRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [columnCount, setColumnCount] = useState(1);

  // Callback ref: attach the observer whenever the container node mounts,
  // regardless of render timing (the early returns can delay its mount).
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      const count = Math.max(1, Math.floor((width + GAP) / (COLUMN_WIDTH + GAP)));
      setColumnCount(count);
    });
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, []);

  // Distribute images round-robin so they read left-to-right, row by row.
  const columns: typeof images[] = Array.from({ length: columnCount }, () => []);
  images.forEach((item, i) => {
    columns[i % columnCount].push(item);
  });

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore) {
        loadMore();
      }
    }, {
      rootMargin: '100px',
    });
    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }
    return () => {
      observer.disconnect()
    };
  }
    , [loadMore])

  if (isError) {
    return <div>Something went wrong.</div>;
  }

  if (!isFetching && !images.length) {
    return <div>No images found.</div>;
  }

  return (
    <div>
      <div
        ref={containerRef}
        style={{
          display: "flex",
          gap: `${GAP}px`,
          alignItems: "flex-start",
        }}
      >
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: `${GAP}px`,
              flex: 1,
              minWidth: 0,
            }}
          >
            {column.map((item) => (
              <img
                key={item.id}
                src={item.image.url}
                alt={item.image.alternativeText || ""}
                loading="lazy"
                style={{
                  width: "100%",
                  aspectRatio: `${item.image.width} / ${item.image.height}`,
                  display: "block",
                  borderRadius: "8px",
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div ref={sentinelRef}></div>
      {isFetching && <div>Loading...</div>}
    </div>
  )
}
