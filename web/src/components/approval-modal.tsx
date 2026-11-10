import { useState } from "react";
import { Modal } from "@/components/modal";

/**
 * Shown right after you approve someone: the activation code and a ready-to-send
 * message. There's no email service wired in, so you send it yourself - the
 * button opens your own mail app with the message filled in.
 */
export function ApprovalModal({
  email,
  activationCode,
  onClose,
}: {
  email: string | null;
  activationCode: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"code" | "message" | null>(null);

  const message =
    `Hello,\n\nYour TechWolf Inventory account has been approved.\n\n` +
    `Activation code: ${activationCode}\n\n` +
    `Open the app and enter this activation code. After activation, create your business administrator account in the app.\n\n` +
    `Welcome aboard!`;

  async function copy(text: string, which: "code" | "message") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked - the text is selectable below */
    }
  }

  return (
    <Modal title="Approved - send them the code" onClose={onClose}>
      <p className="mb-3 text-sm text-gray-600">
        {email ?? "This customer"} can now activate the app. Send them this code; after activation, they create their
        business administrator account in the app.
      </p>
      <div className="mb-3 select-all rounded-lg bg-gray-50 p-3 text-center font-mono text-base font-semibold">
        {activationCode}
      </div>
      <div className="mb-4 flex gap-2">
        <button className="btn-secondary flex-1" onClick={() => copy(activationCode, "code")}>
          {copied === "code" ? "Copied ✓" : "Copy code"}
        </button>
        <button className="btn-secondary flex-1" onClick={() => copy(message, "message")}>
          {copied === "message" ? "Copied ✓" : "Copy message"}
        </button>
      </div>
      {email && (
        <a
          className="btn-primary mb-2 block w-full text-center"
          href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Your TechWolf Inventory activation code")}&body=${encodeURIComponent(message)}`}
        >
          Open in my email app
        </a>
      )}
      <button className="btn-secondary w-full" onClick={onClose}>
        Done
      </button>
    </Modal>
  );
}
