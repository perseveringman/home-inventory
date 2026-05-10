import { useEffect, useState } from 'react';
import { create } from 'zustand';

interface ToastState {
  msg: string;
  visible: boolean;
  show: (msg: string, ms?: number) => void;
}

const useToastStore = create<ToastState>((set) => ({
  msg: '',
  visible: false,
  show: (msg, ms = 1800) => {
    set({ msg, visible: true });
    setTimeout(() => set({ visible: false }), ms);
  },
}));

export function toast(msg: string, ms?: number) {
  useToastStore.getState().show(msg, ms);
}

export function ToastHost() {
  const { msg, visible } = useToastStore();
  return <div className={`toast ${visible ? 'show' : ''}`}>{msg}</div>;
}
