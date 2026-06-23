import { GalleryItem } from "../store/imagesApi";
import { useEffect, useRef, useState } from "react";
import { useGetImageMetaQuery, useUpdateImageDescMutation, useToggleLikeMutation } from "../store/imagesApi";
import { Dialog, TextArea, Flex, Button } from "@radix-ui/themes";

interface ImageDialogProps {
  galleryItem: GalleryItem,
  open: boolean,
  onOpenChange: (open: boolean) => void
}

export function ImageDialog({ galleryItem, open, onOpenChange }: ImageDialogProps) {
  const { data: meta } = useGetImageMetaQuery(galleryItem.id)
  const [updateImageDesc] = useUpdateImageDescMutation();
  const [toggleLike] = useToggleLikeMutation();

  const [draft, setDraft] = useState('')
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) { seeded.current = false; return; }
    if (meta && !seeded.current) {
      setDraft(meta.desc);
      seeded.current = true;
    }
  }, [open, meta]);
  const dirty = meta != null && draft !== meta?.desc;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>
          Image {galleryItem.id}
        </Dialog.Title>
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
        />
        <Flex gap="3" mt="3" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">Cancel</Button>
          </Dialog.Close>
          <Button
            onClick={() => void toggleLike(galleryItem.id)}
          >
            {meta?.liked ? "Unlike" : "Like"}
          </Button>
          <Button
            disabled={!dirty}
            onClick={() => void updateImageDesc({ id: galleryItem.id, desc: draft })}
          >
            Save
          </Button>
        </Flex>

      </Dialog.Content>
    </Dialog.Root>
  )
}
