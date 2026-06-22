import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Flex } from "@radix-ui/themes";
import { useInfiniteImages } from "../hooks/useInfiniteImages";
import { GalleryItem } from "../store/imagesApi";

const COLUMN_WIDTH = 200;
const TARGET_ROW_HEIGHT = 240;
const GAP = 12;
const LAYOUT_STORAGE_KEY = "imageWaterfall.layout";

type Layout = "columns" | "justified";

function getStoredLayout(): Layout {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return stored === "justified" || stored === "columns" ? stored : "columns";
  } catch {
    return "columns";
  }
}

function storeLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Ignore: storage may be unavailable (private mode, quota, disabled).
  }
}

interface JustifiedRow {
  items: GalleryItem[];
  height: number;
  stretch: boolean;
}

// Fill rows left-to-right, then scale each full row to exactly fill the width.
// Preserves reading order AND avoids ragged column ends.
function buildJustifiedRows(
  items: GalleryItem[],
  containerWidth: number
): JustifiedRow[] {
  if (containerWidth <= 0) return [];

  const rows: JustifiedRow[] = [];
  let current: GalleryItem[] = [];
  let aspectSum = 0;

  for (const item of items) {
    const ar = item.image.width / item.image.height;
    current.push(item);
    aspectSum += ar;

    const naturalWidth =
      aspectSum * TARGET_ROW_HEIGHT + (current.length - 1) * GAP;
    if (naturalWidth >= containerWidth) {
      const available = containerWidth - (current.length - 1) * GAP;
      rows.push({ items: current, height: available / aspectSum, stretch: true });
      current = [];
      aspectSum = 0;
    }
  }

  // Last incomplete row: keep target height, left-aligned (don't stretch).
  if (current.length) {
    rows.push({ items: current, height: TARGET_ROW_HEIGHT, stretch: false });
  }

  return rows;
}

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
  const [containerWidth, setContainerWidth] = useState(0);
  const [layout, setLayout] = useState<Layout>(getStoredLayout);

  const changeLayout = (next: Layout) => {
    setLayout(next);
    storeLayout(next);
  };

  // Callback ref: attach the observer whenever the container node mounts,
  // regardless of render timing (the early returns can delay its mount).
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, []);

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

  // --- columns layout: round-robin into N columns, reads left-to-right ---
  const columnCount = Math.max(
    1,
    Math.floor((containerWidth + GAP) / (COLUMN_WIDTH + GAP))
  );
  const columns: GalleryItem[][] = Array.from({ length: columnCount }, () => []);
  images.forEach((item, i) => {
    columns[i % columnCount].push(item);
  });

  // --- justified layout: rows scaled to fill width ---
  const rows = buildJustifiedRows(images, containerWidth);

  return (
    <div>
      <Flex gap="2" mb="4" align="center">
        <Button
          variant={layout === "columns" ? "solid" : "soft"}
          onClick={() => changeLayout("columns")}
        >
          Columns
        </Button>
        <Button
          variant={layout === "justified" ? "solid" : "soft"}
          onClick={() => changeLayout("justified")}
        >
          Justified
        </Button>
      </Flex>

      <div ref={containerRef}>
        {layout === "columns" ? (
          <div style={{ display: "flex", gap: `${GAP}px`, alignItems: "flex-start" }}>
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
        ) : (
          <div>
            {rows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                style={{
                  display: "flex",
                  gap: `${GAP}px`,
                  height: `${row.height}px`,
                  marginBottom: `${GAP}px`,
                }}
              >
                {row.items.map((item) => {
                  const ar = item.image.width / item.image.height;
                  return (
                    <img
                      key={item.id}
                      src={item.image.url}
                      alt={item.image.alternativeText || ""}
                      loading="lazy"
                      style={{
                        height: "100%",
                        width: row.stretch ? undefined : `${row.height * ar}px`,
                        flexGrow: row.stretch ? ar : 0,
                        flexShrink: row.stretch ? 1 : 0,
                        flexBasis: row.stretch ? 0 : "auto",
                        minWidth: 0,
                        objectFit: "cover",
                        display: "block",
                        borderRadius: "8px",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div ref={sentinelRef}></div>
      {isFetching && <div>Loading...</div>}
    </div>
  )
}
