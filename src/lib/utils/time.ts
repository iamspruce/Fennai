export function getTimeBasedGreeting(name: string = 'there'): string {
    const hour = new Date().getHours();

    let timeOfDay: string;

    if (hour >= 0 && hour < 6) {
        timeOfDay = 'Late Night';
    } else if (hour >= 6 && hour < 12) {
        timeOfDay = 'Morning';
    } else if (hour >= 12 && hour < 17) {
        timeOfDay = 'Afternoon';
    } else if (hour >= 17 && hour < 21) {
        timeOfDay = 'Evening';
    } else {
        timeOfDay = 'Night';
    }

    return `It's ${timeOfDay}, ${name}`;
}

export function formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(date);
}

export function formatDateTime(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

export function getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return formatDate(date);
}