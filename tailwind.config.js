/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // WCAG AA-safe values for the "brand" accent used throughout the
                // dashboard (bg-brand, text-brand, gradients) — this token was
                // referenced everywhere but never defined, so it silently failed
                // to render in light mode (white text on an unstyled/white bg).
                brand: {
                    DEFAULT: "#2563eb",
                    soft: "#eef1fe",
                    dark: "#60a5fa",
                },
                "on-background": "#0b1c30",
                "inverse-surface": "#213145",
                "primary-container": "#2170e4",
                "on-tertiary-fixed-variant": "#173bab",
                "on-error-container": "#93000a",
                "secondary-fixed-dim": "#a4c9ff",
                "background": "#f8f9ff",
                "on-primary-fixed-variant": "#004395",
                "on-tertiary-fixed": "#001453",
                "on-primary-fixed": "#001a42",
                "inverse-primary": "#adc6ff",
                "surface-container-lowest": "#ffffff",
                "on-secondary": "#ffffff",
                "on-primary": "#ffffff",
                "error-container": "#ffdad6",
                "on-secondary-fixed": "#001c39",
                "secondary": "#0060ac",
                "on-surface-variant": "#424754",
                "surface-dim": "#cbdbf5",
                "primary-fixed-dim": "#adc6ff",
                "on-secondary-fixed-variant": "#004883",
                "inverse-on-surface": "#eaf1ff",
                "primary": "#0058be",
                "surface-tint": "#005ac2",
                "surface-container-low": "#eff4ff",
                "error": "#ba1a1a",
                "primary-fixed": "#d8e2ff",
                "surface-container-high": "#dce9ff",
                "tertiary": "#3452c1",
                "secondary-container": "#64a8fe",
                "tertiary-container": "#506cdb",
                "on-secondary-container": "#003c70",
                "outline-variant": "#c2c6d6",
                "on-tertiary": "#ffffff",
                "on-primary-container": "#fefcff",
                "secondary-fixed": "#d4e3ff",
                "surface-bright": "#f8f9ff",
                "on-error": "#ffffff",
                "outline": "#727785",
                "surface-container": "#e5eeff",
                "tertiary-fixed": "#dde1ff",
                "surface": "#f8f9ff",
                "surface-container-highest": "#d3e4fe",
                "on-surface": "#0b1c30",
                "on-tertiary-container": "#fffbff",
                "tertiary-fixed-dim": "#b8c4ff",
                "surface-variant": "#d3e4fe"
            },
            borderRadius: {
                DEFAULT: "0.5rem",
                sm: "0.25rem",
                md: "0.75rem",
                lg: "1rem",
                xl: "1.5rem",
                full: "9999px"
            },
            spacing: {
                xs: "4px",
                sm: "8px",
                md: "16px",
                lg: "24px",
                xl: "48px",
                xxl: "80px",
                gutter: "24px",
                margin_mobile: "16px",
                margin_desktop: "40px"
            },
            fontFamily: {
                sans: ["Space Grotesk", "sans-serif"],
                h1: ["Space Grotesk"],
                h2: ["Space Grotesk"],
                h3: ["Space Grotesk"],
                "body-lg": ["Space Grotesk"],
                "body-md": ["Space Grotesk"],
                "label-sm": ["Space Grotesk"],
                caption: ["Space Grotesk"]
            },
            fontSize: {
                h1: ["40px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "700" }],
                h2: ["32px", { lineHeight: "1.25", letterSpacing: "-0.01em", fontWeight: "600" }],
                h3: ["24px", { lineHeight: "1.3", fontWeight: "600" }],
                "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
                "body-md": ["16px", { lineHeight: "1.5", fontWeight: "400" }],
                "label-sm": ["14px", { lineHeight: "1.4", letterSpacing: "0.01em", fontWeight: "500" }],
                caption: ["12px", { lineHeight: "1.2", fontWeight: "500" }]
            }
        },
    },
    plugins: [],
}
