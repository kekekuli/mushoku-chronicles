import { CSSProperties, useState } from "react";
import { GalleryItem, useGetImageMetaQuery, useToggleLikeMutation } from "../store/imagesApi";
import { ImageDialog } from "./ImageDialog";

interface GalleryImageProps {
  item: GalleryItem;
  wrapperStyle: CSSProperties,
  imageStyle: CSSProperties
}

export default function GalleryImage({ item, wrapperStyle, imageStyle }: GalleryImageProps) {
  const { data: meta, isLoading } = useGetImageMetaQuery(item.id);
  const [toggleLike] = useToggleLikeMutation();
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
