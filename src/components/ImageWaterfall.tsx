import { useEffect, useRef } from "react";
import { useInfiniteImages } from "../hooks/useInfiniteImages";
import { Grid } from "@radix-ui/themes";

export default function ImageWaterfall() {
  const {
    images,
    isFetching,
    isError,
    hasMore,
    loadMore,
  } = useInfiniteImages();

  const sentinelRef = useRef<HTMLDivElement>(null);

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
      <Grid columns='repeat(auto-fill, minmax(200px, 1fr))' gap='12px' p='4'>
        {images.map((item) => (
          <img
            key={item.id}
            src={item.image.url}
            alt={item.image.alternativeText || ""}
            loading="lazy"
            style={{ width: "100%" }}
          />
        ))}
      </Grid>
      <div ref={sentinelRef}></div>
      {isFetching && <div>Loading...</div>}
    </div>
  )
}
