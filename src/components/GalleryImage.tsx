import { CSSProperties } from "react";
import { GalleryItem, useGetImageMetaQuery, useToggleLikeMutation } from "../store/imagesApi";

interface GalleryImageProps {
  item: GalleryItem;
  wrapperStyle: CSSProperties,
  imageStyle: CSSProperties
}

export default function GalleryImage({ item, wrapperStyle, imageStyle }: GalleryImageProps) {
  const { data: meta, isLoading } = useGetImageMetaQuery(item.id);
  const [toggleLike] = useToggleLikeMutation();

  return (
    <div
      style={{
        position: "relative",
        ...wrapperStyle,
      }}
    >
      <img
        key={item.id}
        alt={item.image.alternativeText || ""}
        loading="lazy"
        style={imageStyle}
      />
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
        }}
      >
        <button type="button" onClick={() => void toggleLike(item.id)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            font: "inherit",
            color: "#fff",
            textShadow: "0 1px 3px rgba(0,0,0,0.3)",
            transition: "color 0.15s",
          }}
        >
          <span style={{ color: meta?.liked ? "crimson" : "#bbb" }}>♥</span>{" "}
          {isLoading ? "…" : meta?.like}
        </button>
      </div>
    </div>
  )
}
