import { motion } from "framer-motion";
import { AVATAR_STYLES, generateAvatarUrl } from "../../lib/utils/avatar";
import { useState, useEffect } from "react";
import "../../styles/AvatarGrid.css"; // We will define the styles below

interface Props {
    initialStyle?: string;
}

export default function AvatarGrid({ initialStyle = AVATAR_STYLES[0] }: Props) {
    const [selected, setSelected] = useState(initialStyle);

    // Update a hidden input field so the form can submit naturally
    const updateHiddenInput = (value: string) => {
        const input = document.getElementById("hidden-avatar-input") as HTMLInputElement;
        if (input) input.value = value;
    };

    useEffect(() => {
        updateHiddenInput(selected);
    }, [selected]);

    return (
        <div className="avatar-grid-container">
            {AVATAR_STYLES.map((style) => (
                <div key={style} className="avatar-wrapper" onClick={() => setSelected(style)}>
                    {/* The Spring Physics Highlight Ring */}
                    {selected === style && (
                        <motion.div
                            layoutId="avatar-ring"
                            className="avatar-highlight"
                            transition={{ type: "spring", stiffness: 350, damping: 25 }}
                        />
                    )}

                    <motion.img
                        src={generateAvatarUrl(`character-${style}`, style)}
                        alt={style}
                        className="avatar-image"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    />
                </div>
            ))}
        </div>
    );
}