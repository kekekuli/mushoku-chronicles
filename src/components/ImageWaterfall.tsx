import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import { useInfiniteImages } from "../hooks/useInfiniteImages";
import { GalleryItem, useAddImageMutation } from "../store/imagesApi";
import GalleryImage from "./GalleryImage";

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

// Pull the worker's { error } message out of an RTK FetchBaseQueryError.
function getUploadErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && "error" in data) {
      const error = (data as { error?: unknown }).error;
      if (typeof error === "string") return error;
    }
  }
  return "Upload failed";
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
    refresh,
  } = useInfiniteImages();

  const sentinelRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [layout, setLayout] = useState<Layout>(getStoredLayout);

  const changeLayout = (next: Layout) => {
    setLayout(next);
    storeLayout(next);
  };

  const [addImage, { isLoading: isUploading }] = useAddImageMutation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-picked
    if (!file) return;

    setUploadError(null);
    const formData = new FormData();
    formData.append("files", file); // field name the worker reads
    try {
      await addImage(formData).unwrap();
    } catch (err) {
      setUploadError(getUploadErrorMessage(err));
    }
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
        <Button color="gray" variant="outline" onClick={() => void refresh()}>
          Refresh
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => void handleFileSelected(e)}
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? "Uploading…" : "Add image"}
        </Button>
        {uploadError && (
          <Text color="red" size="2">
            {uploadError}
          </Text>
        )}
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
                  <GalleryImage
                    key={item.id}
                    item={item}
                    wrapperStyle={{ width: '100%' }}
                    imageStyle={{
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
                    <GalleryImage
                      key={item.id}
                      item={item}
                      wrapperStyle={{
                        width: row.stretch ? undefined : `${row.height * ar}px`,
                        flexGrow: row.stretch ? ar : 0,
                        flexShrink: row.stretch ? 1 : 0,
                        flexBasis: row.stretch ? 0 : "auto",
                        height: "100%",
                        minWidth: 0,
                      }}
                      imageStyle={{
                        width: "100%",
                        height: "100%",
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
