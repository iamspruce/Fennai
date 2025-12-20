import React, { useState, useEffect } from "react";
import { Icon } from "@iconify/react";

interface AlertData {
    title: string;
    message: string;
    type?: "info" | "success" | "warning" | "error";
    details?: string;
}

const AlertModal: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [data, setData] = useState<AlertData | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    // Environment variable to control technical details visibility
    const SHOW_DETAILED_ERRORS = import.meta.env.PUBLIC_SHOW_DETAILED_ERRORS === "true";

    useEffect(() => {
        const handleShowAlert = (e: CustomEvent<AlertData>) => {
            setData(e.detail);
            setIsOpen(true);
            setShowDetails(false); // Reset details toggle
        };

        window.addEventListener("show-alert" as any, handleShowAlert);
        return () => window.removeEventListener("show-alert" as any, handleShowAlert);
    }, []);

    const close = () => {
        setIsOpen(false);
        setTimeout(() => setData(null), 300); // Wait for animation
    };

    if (!isOpen && !data) return null;

    const getIcon = () => {
        switch (data?.type) {
            case "success": return "lucide:check-circle";
            case "warning": return "lucide:alert-triangle";
            case "error": return "lucide:alert-circle";
            default: return "lucide:info";
        }
    };

    const getIconColor = () => {
        switch (data?.type) {
            case "success": return "var(--green-9)";
            case "warning": return "var(--orange-9)";
            case "error": return "var(--red-9)";
            default: return "var(--blue-9)";
        }
    };

    return (
        <div className={`modal-overlay ${isOpen ? "active" : ""}`} onClick={close} style={{ zIndex: 10001 }}>
            <div
                className="modal-content"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: "400px", borderRadius: "16px", padding: "0" }}
            >
                <div className="modal-body" style={{ padding: "var(--space-l)", textAlign: "center" }}>
                    <div style={{ marginBottom: "var(--space-m)" }}>
                        <Icon
                            icon={getIcon()}
                            style={{ fontSize: "48px", color: getIconColor() }}
                        />
                    </div>

                    <h3 className="modal-title" style={{ marginBottom: "var(--space-xs)", fontSize: "1.25rem" }}>
                        {data?.title || "Alert"}
                    </h3>

                    <p style={{ color: "var(--mauve-11)", lineHeight: "1.5", fontSize: "0.95rem" }}>
                        {data?.message}
                    </p>

                    {data?.details && (
                        <div style={{ marginTop: "var(--space-m)", textAlign: "left" }}>
                            <button
                                onClick={() => setShowDetails(!showDetails)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--mauve-10)",
                                    fontSize: "0.8rem",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    padding: "0"
                                }}
                            >
                                <Icon icon={showDetails ? "lucide:chevron-down" : "lucide:chevron-right"} />
                                {showDetails ? "Hide technical details" : "Show technical details"}
                            </button>

                            {showDetails && (
                                <div style={{
                                    marginTop: "8px",
                                    padding: "12px",
                                    background: "var(--mauve-2)",
                                    border: "1px solid var(--mauve-4)",
                                    borderRadius: "8px",
                                    fontSize: "0.75rem",
                                    fontFamily: "monospace",
                                    color: "var(--mauve-11)",
                                    maxHeight: "150px",
                                    overflowY: "auto",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-all"
                                }}>
                                    {data.details}
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        className="btn-nudge" // Reuse some existing btn style if available or just inline
                        onClick={close}
                        style={{
                            marginTop: "var(--space-l)",
                            width: "100%",
                            background: "var(--mauve-12)",
                            color: "var(--mauve-1)",
                            border: "none",
                            padding: "12px",
                            borderRadius: "12px",
                            fontWeight: "600",
                            cursor: "pointer"
                        }}
                    >
                        Okay
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AlertModal;
