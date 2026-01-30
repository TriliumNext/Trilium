interface Window {
    showToast(message: string, opts?: {
        settings?: {
            duration: number;
        }
    }): void;
}
