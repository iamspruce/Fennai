// Generate avatar URL using DiceBear API or similar
export function generateAvatarUrl(seed: string, style: string = 'avataaars'): string {
    return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

// Generate initials from name
export function getInitials(name: string): string {
    return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

// Generate color based on string (for consistent user colors)
export function getColorFromString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = hash % 360;
    return `hsl(${hue}, 65%, 55%)`;
}

// Predefined avatar options for character creation
export const AVATAR_STYLES = [
    'adventurer',
    'avataaars',
    'bottts',
    'fun-emoji',
    'lorelei',
    'micah',
    'personas',
    'pixel-art',
] as const;

export type AvatarStyle = typeof AVATAR_STYLES[number];