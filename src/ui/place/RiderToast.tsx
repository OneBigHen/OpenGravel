"use client";

import { useEffect } from "react";

export interface ToastNotice { readonly id: number; readonly message: string; readonly undo?: (() => void) | undefined }

export function RiderToast({ notice, onDismiss }: { readonly notice: ToastNotice; readonly onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [notice.id, onDismiss]);
  return <div className="og-rider-toast" role="status" data-testid="rider-toast">
    <span>{notice.message}</span>
    {notice.undo === undefined ? null : <button type="button" onClick={() => { notice.undo?.(); onDismiss(); }}>Undo</button>}
  </div>;
}
