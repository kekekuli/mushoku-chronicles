import { CSSProperties, useState } from "react";
import { GalleryItem, useGetImageMetaQuery, useToggleLikeMutation, useRemoveImageMutation } from "../store/imagesApi";
import { ImageDialog } from "./ImageDialog";

interface GalleryImageProps {
  item: GalleryItem;
  wrapperStyle: CSSProperties,
  imageStyle: CSSProperties
}

export default function GalleryImage({ item, wrapperStyle, imageStyle }: GalleryImageProps) {
  const { data: meta, isLoading } = useGetImageMetaQuery(item.id);
  const [toggleLike] = useToggleLikeMutation();
  const [removeImage] = useRemoveImageMutation();
  const [open, setOpen] = useState(false);

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
        onClick={() => setOpen(true)}
        style={{ ...imageStyle, cursor: "pointer" }}
      />
      <button
        type="button"
        aria-label="Remove image"
        onClick={(e) => { e.stopPropagation(); void removeImage(item.id); }}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 24,
          height: 24,
          lineHeight: "22px",
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          color: "#fff",
          background: "rgba(0,0,0,0.45)",
        }}
      >
        ×
      </button>
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
        }}
      >
        <button type="button" onClick={(e) => { e.stopPropagation(); void toggleLike(item.id); }}
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
      <ImageDialog galleryItem={item} open={open} onOpenChange={setOpen} />
    </div>
  )
}
