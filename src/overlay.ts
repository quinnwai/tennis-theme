/**
 * A dialog that opens over the toy, with the toy still running behind it, and closes with Escape, with its close button, and with a click
 * on the dimmed toy around its content. The credits and the notebook are both one. `content` is the part that a click does not close it
 * from, such as the text. The press has to start outside the content as well as end there, so that selecting some text and letting go
 * beside it is not a click outside.
 *
 * A modal dialog brings Escape, focus and a shut-out page with it. With ?tune (`tuning`) the sliders have to stay in reach, so the
 * dialog opens as a plain one that sits under them instead, and Escape is handled here.
 */
export function wireOverlay(dialog: HTMLDialogElement, content: HTMLElement, closeButton: HTMLElement, tuning: boolean) {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dialog.close();
  });
  closeButton.addEventListener("click", () => dialog.close());
  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (e) => (pressedOutside = !content.contains(e.target as Node)));
  dialog.addEventListener("click", (e) => {
    if (pressedOutside && !content.contains(e.target as Node)) dialog.close();
  });
  return {
    open: () => (tuning ? dialog.show() : dialog.showModal()),
    close: () => dialog.close(),
    isOpen: () => dialog.open,
  };
}
