// taken from the HTML source of https://boxicons.com/

export interface Category {
    name: string;
    id: number;
}

export interface Icon {
    name: string;
    slug: string;
    category_id: number;
    type_of_icon: "REGULAR" | "SOLID" | "LOGO";
    term?: string[];
    className?: string;
}

const categories: Category[] = [
    { name: "All categories", id: 0 },
    {
        name: "Accessibility",
        id: 94
    },
    {
        name: "Alert",
        id: 95
    },
    {
        name: "Animals",
        id: 125
    },
    {
        name: "Arrow",
        id: 96
    },
    {
        name: "Brands",
        id: 97
    },
    {
        name: "Building",
        id: 98
    },
    {
        name: "Business",
        id: 99
    },
    {
        name: "Code",
        id: 100
    },
    {
        name: "Communication",
        id: 101
    },
    {
        name: "Design",
        id: 102
    },
    {
        name: "Device",
        id: 103
    },
    {
        name: "E-Commerce",
        id: 104
    },
    {
        name: "Emoji",
        id: 105
    },
    {
        name: "Files \u0026 Folders",
        id: 106
    },
    {
        name: "Finance",
        id: 107
    },
    {
        name: "Food \u0026 Beverage",
        id: 108
    },
    {
        name: "Health",
        id: 109
    },
    {
        name: "Interface",
        id: 110
    },
    {
        name: "Layout",
        id: 111
    },
    {
        name: "Loader",
        id: 112
    },
    {
        name: "Misc",
        id: 113
    },
    {
        name: "Music",
        id: 114
    },
    {
        name: "Network",
        id: 115
    },
    {
        name: "Object",
        id: 116
    },
    {
        name: "Photo \u0026 Video",
        id: 117
    },
    {
        name: "Shape",
        id: 118
    },
    {
        name: "Sports \u0026 Games",
        id: 119
    },
    {
        name: "Time",
        id: 120
    },
    {
        name: "Travel",
        id: 121
    },
    {
        name: "User",
        id: 122
    },
    {
        name: "Weather",
        id: 123
    },
    {
        name: "Writing",
        id: 124
    }
];

const icons: Icon[] = [
    {
        name: "child",
        slug: "child-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "balloon",
        slug: "balloon-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "coffee-bean",
        slug: "coffee-bean-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "pear",
        slug: "pear-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "sushi",
        slug: "sushi-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "sushi",
        slug: "sushi-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "shower",
        slug: "shower-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "shower",
        slug: "shower-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "typescript",
        slug: "typescript-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "graphql",
        slug: "graphql-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "rfid",
        slug: "rfid-regular",
        category_id: 115,
        type_of_icon: "REGULAR"
    },
    {
        name: "universal-access",
        slug: "universal-access-solid",
        category_id: 94,
        type_of_icon: "SOLID"
    },
    {
        name: "universal-access",
        slug: "universal-access-regular",
        category_id: 94,
        type_of_icon: "REGULAR"
    },
    {
        name: "castle",
        slug: "castle-solid",
        category_id: 98,
        type_of_icon: "SOLID",
        term: ["fort", "secure"]
    },
    {
        name: "shield-minus",
        slug: "shield-minus-solid",
        category_id: 100,
        type_of_icon: "SOLID"
    },
    {
        name: "shield-minus",
        slug: "shield-minus-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "shield-plus",
        slug: "shield-plus-solid",
        category_id: 100,
        type_of_icon: "SOLID"
    },
    {
        name: "shield-plus",
        slug: "shield-plus-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "vertical-bottom",
        slug: "vertical-bottom-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "vertical-top",
        slug: "vertical-top-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "horizontal-right",
        slug: "horizontal-right-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "horizontal-left",
        slug: "horizontal-left-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "objects-vertical-bottom",
        slug: "objects-vertical-bottom-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "objects-vertical-bottom",
        slug: "objects-vertical-bottom-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "objects-vertical-center",
        slug: "objects-vertical-center-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "objects-vertical-center",
        slug: "objects-vertical-center-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "objects-vertical-top",
        slug: "objects-vertical-top-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "objects-vertical-top",
        slug: "objects-vertical-top-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "objects-horizontal-right",
        slug: "objects-horizontal-right-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "objects-horizontal-right",
        slug: "objects-horizontal-right-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "objects-horizontal-center",
        slug: "objects-horizontal-center-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "objects-horizontal-center",
        slug: "objects-horizontal-center-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "objects-horizontal-left",
        slug: "objects-horizontal-left-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "objects-horizontal-left",
        slug: "objects-horizontal-left-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "color",
        slug: "color-solid",
        category_id: 102,
        type_of_icon: "SOLID",
        term: ["palette", "wheel"]
    },
    {
        name: "color",
        slug: "color-regular",
        category_id: 102,
        type_of_icon: "REGULAR",
        term: ["palette", "wheel"]
    },
    {
        name: "reflect-horizontal",
        slug: "reflect-horizontal-regular",
        category_id: 111,
        type_of_icon: "REGULAR",
        term: ["flip"]
    },
    {
        name: "reflect-vertical",
        slug: "reflect-vertical-regular",
        category_id: 111,
        type_of_icon: "REGULAR",
        term: ["flip"]
    },
    {
        name: "postgresql",
        slug: "postgresql-logo",
        category_id: 100,
        type_of_icon: "LOGO",
        term: ["database", "db", "sql"]
    },
    {
        name: "mongodb",
        slug: "mongodb-logo",
        category_id: 100,
        type_of_icon: "LOGO",
        term: ["database", "db"]
    },
    {
        name: "deezer",
        slug: "deezer-logo",
        category_id: 114,
        type_of_icon: "LOGO",
        term: ["music"]
    },
    {
        name: "xing",
        slug: "xing-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["search"]
    },
    {
        name: "cart-add",
        slug: "cart-add-regular",
        category_id: 104,
        type_of_icon: "REGULAR",
        term: ["buy"]
    },
    {
        name: "cart-download",
        slug: "cart-download-regular",
        category_id: 104,
        type_of_icon: "REGULAR",
        term: ["buy"]
    },
    {
        name: "no-signal",
        slug: "no-signal-regular",
        category_id: 115,
        type_of_icon: "REGULAR",
        term: ["network", "connection"]
    },
    {
        name: "signal-5",
        slug: "signal-5-regular",
        category_id: 115,
        type_of_icon: "REGULAR",
        term: ["network", "connection"]
    },
    {
        name: "signal-4",
        slug: "signal-4-regular",
        category_id: 115,
        type_of_icon: "REGULAR",
        term: ["network", "connection"]
    },
    {
        name: "signal-3",
        slug: "signal-3-regular",
        category_id: 115,
        type_of_icon: "REGULAR",
        term: ["network", "connection"]
    },
    {
        name: "signal-2",
        slug: "signal-2-regular",
        category_id: 115,
        type_of_icon: "REGULAR",
        term: ["network", "connection"]
    },
    {
        name: "signal-1",
        slug: "signal-1-regular",
        category_id: 115,
        type_of_icon: "REGULAR",
        term: ["network", "connection"]
    },
    {
        name: "cheese",
        slug: "cheese-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "cheese",
        slug: "cheese-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "hard-hat",
        slug: "hard-hat-solid",
        category_id: 98,
        type_of_icon: "SOLID",
        term: ["construction", "worker", "labour"]
    },
    {
        name: "hard-hat",
        slug: "hard-hat-regular",
        category_id: 98,
        type_of_icon: "REGULAR",
        term: ["construction", "worker", "labour"]
    },
    {
        name: "home-alt-2",
        slug: "home-alt-2-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "home-alt-2",
        slug: "home-alt-2-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "meta",
        slug: "meta-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["facebook", "social media"]
    },
    {
        name: "lemon",
        slug: "lemon-solid",
        category_id: 108,
        type_of_icon: "SOLID",
        term: ["lime", "fruit", "vegetable"]
    },
    {
        name: "lemon",
        slug: "lemon-regular",
        category_id: 108,
        type_of_icon: "REGULAR",
        term: ["lime", "fruit", "vegetable"]
    },
    {
        name: "cable-car",
        slug: "cable-car-solid",
        category_id: 121,
        type_of_icon: "SOLID",
        term: ["transportation", "hill", "travel"]
    },
    {
        name: "cable-car",
        slug: "cable-car-regular",
        category_id: 121,
        type_of_icon: "REGULAR",
        term: ["transportation", "hill", "travel"]
    },
    {
        name: "cricket-ball",
        slug: "cricket-ball-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["sport"]
    },
    {
        name: "cricket-ball",
        slug: "cricket-ball-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["sport"]
    },
    {
        name: "tree-alt",
        slug: "tree-alt-solid",
        category_id: 121,
        type_of_icon: "SOLID",
        term: ["forest", "christmas"]
    },
    {
        name: "male-female",
        slug: "male-female-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "invader",
        slug: "invader-solid",
        category_id: 119,
        type_of_icon: "SOLID"
    },
    {
        name: "baguette",
        slug: "baguette-solid",
        category_id: 108,
        type_of_icon: "SOLID",
        term: ["bread", "bake", "baking", "food", "nutrition"]
    },
    {
        name: "baguette",
        slug: "baguette-regular",
        category_id: 108,
        type_of_icon: "REGULAR",
        term: ["bread", "bake", "baking", "food", "nutrition"]
    },
    {
        name: "fork",
        slug: "fork-regular",
        category_id: 108,
        type_of_icon: "REGULAR",
        term: ["utensil", "restaurant"]
    },
    {
        name: "knife",
        slug: "knife-regular",
        category_id: 108,
        type_of_icon: "REGULAR",
        term: ["utensil", "restaurant"]
    },
    {
        name: "circle-half",
        slug: "circle-half-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "circle-half",
        slug: "circle-half-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "circle-three-quarter",
        slug: "circle-three-quarter-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "circle-three-quarter",
        slug: "circle-three-quarter-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "circle-quarter",
        slug: "circle-quarter-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "circle-quarter",
        slug: "circle-quarter-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "bowl-rice",
        slug: "bowl-rice-solid",
        category_id: 108,
        type_of_icon: "SOLID",
        term: ["food"]
    },
    {
        name: "bowl-rice",
        slug: "bowl-rice-regular",
        category_id: 108,
        type_of_icon: "REGULAR",
        term: ["food"]
    },
    {
        name: "bowl-hot",
        slug: "bowl-hot-solid",
        category_id: 108,
        type_of_icon: "SOLID",
        term: ["food", "heat"]
    },
    {
        name: "bowl-hot",
        slug: "bowl-hot-regular",
        category_id: 108,
        type_of_icon: "REGULAR",
        term: ["food", "heat"]
    },
    {
        name: "popsicle",
        slug: "popsicle-solid",
        category_id: 108,
        type_of_icon: "SOLID",
        term: ["ice cream", "dessert"]
    },
    {
        name: "popsicle",
        slug: "popsicle-regular",
        category_id: 108,
        type_of_icon: "REGULAR",
        term: ["ice cream", "dessert"]
    },
    {
        name: "cross",
        slug: "cross-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["gaming", "crosshair", "aim"]
    },
    {
        name: "scatter-chart",
        slug: "scatter-chart-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "money-withdraw",
        slug: "money-withdraw-regular",
        category_id: 107,
        type_of_icon: "REGULAR",
        term: ["atm"]
    },
    {
        name: "candles",
        slug: "candles-regular",
        category_id: 107,
        type_of_icon: "REGULAR",
        term: ["trading", "stock"]
    },
    {
        name: "math",
        slug: "math-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "party",
        slug: "party-regular",
        category_id: 105,
        type_of_icon: "REGULAR",
        term: ["celebration"]
    },
    {
        name: "leaf",
        slug: "leaf-regular",
        category_id: 123,
        type_of_icon: "REGULAR",
        term: ["plant", "crop", "nature"]
    },
    {
        name: "injection",
        slug: "injection-regular",
        category_id: 109,
        type_of_icon: "REGULAR",
        term: ["syringe", "dose"]
    },
    {
        name: "expand-vertical",
        slug: "expand-vertical-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "expand-horizontal",
        slug: "expand-horizontal-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "collapse-vertical",
        slug: "collapse-vertical-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "collapse-horizontal",
        slug: "collapse-horizontal-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "collapse-alt",
        slug: "collapse-alt-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "party",
        slug: "party-solid",
        category_id: 105,
        type_of_icon: "SOLID",
        term: ["celebration"]
    },
    {
        name: "leaf",
        slug: "leaf-solid",
        category_id: 123,
        type_of_icon: "SOLID",
        term: ["plant", "crop", "nature"]
    },
    {
        name: "injection",
        slug: "injection-solid",
        category_id: 109,
        type_of_icon: "SOLID",
        term: ["syringe", "dose"]
    },
    {
        name: "dog",
        slug: "dog-solid",
        category_id: 125,
        type_of_icon: "SOLID",
        term: ["pet", "canine"]
    },
    {
        name: "cat",
        slug: "cat-solid",
        category_id: 125,
        type_of_icon: "SOLID",
        term: ["pet"]
    },
    {
        name: "upwork",
        slug: "upwork-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "netlify",
        slug: "netlify-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "java",
        slug: "java-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "heroku",
        slug: "heroku-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "go-lang",
        slug: "go-lang-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "gmail",
        slug: "gmail-logo",
        category_id: 101,
        type_of_icon: "LOGO"
    },
    {
        name: "flask",
        slug: "flask-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "99designs",
        slug: "99designs-logo",
        category_id: 102,
        type_of_icon: "LOGO"
    },
    {
        name: "venmo",
        slug: "venmo-logo",
        category_id: 107,
        type_of_icon: "LOGO"
    },
    {
        name: "qr",
        slug: "qr-REGULAR",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "qr-scan",
        slug: "qr-scan-logo",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "docker",
        slug: "docker-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "aws",
        slug: "aws-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "hand",
        slug: "hand",
        category_id: 113,
        type_of_icon: "SOLID",
        term: ["palm", "stop"]
    },
    {
        name: "podcast",
        slug: "podcast-regular",
        category_id: 114,
        type_of_icon: "REGULAR",
        term: ["audiobook", "radio"]
    },
    {
        name: "checkbox-minus",
        slug: "checkbox-minus-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "checkbox-minus",
        slug: "checkbox-minus-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "speaker",
        slug: "speaker-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "speaker",
        slug: "speaker-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "registered",
        slug: "registered-solid",
        category_id: 97,
        type_of_icon: "SOLID"
    },
    {
        name: "registered",
        slug: "registered-regular",
        category_id: 97,
        type_of_icon: "REGULAR"
    },
    {
        name: "phone-off",
        slug: "phone-off-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "phone-off",
        slug: "phone-off-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "tiktok",
        slug: "tiktok-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["social media", "entertainment"]
    },
    {
        name: "sketch",
        slug: "sketch-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["web design"]
    },
    {
        name: "steam",
        slug: "steam-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "trip-advisor",
        slug: "trip-advisor-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["travel"]
    },
    {
        name: "visual-studio",
        slug: "visual-studio-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "unity",
        slug: "unity-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "php",
        slug: "php-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "discord-alt",
        slug: "discord-alt-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "flutter",
        slug: "flutter-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "mastodon",
        slug: "mastodon-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "tailwind-css",
        slug: "tailwind-css-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "buildings",
        slug: "buildings-regular",
        category_id: 98,
        type_of_icon: "REGULAR",
        term: ["city", "colony", "skyline", "skyscrapers"]
    },
    {
        name: "buildings",
        slug: "buildings-solid",
        category_id: 98,
        type_of_icon: "SOLID",
        term: ["city", "colony", "skyline", "skyscrapers"]
    },
    {
        name: "store-alt",
        slug: "store-alt-regular",
        category_id: 104,
        type_of_icon: "REGULAR",
        term: ["shop", "market"]
    },
    {
        name: "store-alt",
        slug: "store-alt-solid",
        category_id: 104,
        type_of_icon: "SOLID",
        term: ["shop", "market"]
    },
    {
        name: "bar-chart-alt-2",
        slug: "bar-chart-alt-2-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "bar-chart-alt-2",
        slug: "bar-chart-alt-2-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "message-dots",
        slug: "message-dots-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["loading", "chat", "comment"]
    },
    {
        name: "message-dots",
        slug: "message-dots-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["loading", "chat", "comment"]
    },
    {
        name: "message-rounded-dots",
        slug: "message-rounded-dots-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["loading", "chat", "comment"]
    },
    {
        name: "message-rounded-dots",
        slug: "message-rounded-dots-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["loading", "chat", "comment"]
    },
    {
        name: "devices",
        slug: "devices-solid",
        category_id: 103,
        type_of_icon: "SOLID",
        term: ["mobile", "tab"]
    },
    {
        name: "memory-card",
        slug: "memory-card-regular",
        category_id: 103,
        type_of_icon: "REGULAR",
        term: ["sd card", "storage"]
    },
    {
        name: "memory-card",
        slug: "memory-card-solid",
        category_id: 103,
        type_of_icon: "SOLID",
        term: ["sd card", "storage"]
    },
    {
        name: "wallet-alt",
        slug: "wallet-alt-regular",
        category_id: 107,
        type_of_icon: "REGULAR",
        term: ["money"]
    },
    {
        name: "wallet-alt",
        slug: "wallet-alt-solid",
        category_id: 107,
        type_of_icon: "SOLID",
        term: ["money"]
    },
    {
        name: "bank",
        slug: "bank-solid",
        category_id: 98,
        type_of_icon: "SOLID",
        term: ["institution", "money", "safe"]
    },
    {
        name: "slideshow",
        slug: "slideshow-regular",
        category_id: 99,
        type_of_icon: "REGULAR",
        term: ["presentation", "keynote"]
    },
    {
        name: "slideshow",
        slug: "slideshow-solid",
        category_id: 99,
        type_of_icon: "SOLID",
        term: ["presentation", "keynote"]
    },
    {
        name: "message-square",
        slug: "message-square-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-square-dots",
        slug: "message-square-dots-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["loading", "chat", "comment"]
    },
    {
        name: "message-square",
        slug: "message-square-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-square-dots",
        slug: "message-square-dots-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["loading", "chat", "comment"]
    },
    {
        name: "book-content",
        slug: "book-content-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "book-content",
        slug: "book-content-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "chat",
        slug: "chat-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["discussion", "talk", "comments", "messages"]
    },
    {
        name: "chat",
        slug: "chat-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["discussion", "talk", "comments", "messages"]
    },
    {
        name: "edit-alt",
        slug: "edit-alt-regular",
        category_id: 124,
        type_of_icon: "REGULAR",
        term: ["writing", "note", "pencil"]
    },
    {
        name: "edit-alt",
        slug: "edit-alt-solid",
        category_id: 124,
        type_of_icon: "SOLID",
        term: ["writing", "note", "pencil"]
    },
    {
        name: "mouse-alt",
        slug: "mouse-alt-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "mouse-alt",
        slug: "mouse-alt-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "bug-alt",
        slug: "bug-alt-regular",
        category_id: 100,
        type_of_icon: "REGULAR",
        term: ["error", "warning"]
    },
    {
        name: "bug-alt",
        slug: "bug-alt-solid",
        category_id: 100,
        type_of_icon: "SOLID",
        term: ["error", "warning"]
    },
    {
        name: "notepad",
        slug: "notepad-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "notepad",
        slug: "notepad-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "video-recording",
        slug: "video-recording-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "video-recording",
        slug: "video-recording-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "shape-square",
        slug: "shape-square-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "shape-triangle",
        slug: "shape-triangle-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "direction-left",
        slug: "direction-left-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "ghost",
        slug: "ghost-regular",
        category_id: 105,
        type_of_icon: "REGULAR",
        term: ["spooky", "horror", "scary"]
    },
    {
        name: "ghost",
        slug: "ghost-solid",
        category_id: 105,
        type_of_icon: "SOLID",
        term: ["spooky", "horror", "scary"]
    },
    {
        name: "mail-send",
        slug: "mail-send-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "code-alt",
        slug: "code-alt-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "grid",
        slug: "grid-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "quote-single-left",
        slug: "quote-single-left-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "quote-single-right",
        slug: "quote-single-right-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "user-pin",
        slug: "user-pin-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "user-pin",
        slug: "user-pin-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "run",
        slug: "run-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "copy-alt",
        slug: "copy-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "copy-alt",
        slug: "copy-alt-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "transfer-alt",
        slug: "transfer-alt-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "file-doc",
        slug: "file-doc-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file-html",
        slug: "file-html-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "comment-detail",
        slug: "comment-detail-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "comment-add",
        slug: "comment-add-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "message", "new", "plus"]
    },
    {
        name: "file-css",
        slug: "file-css-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file-js",
        slug: "file-js-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file-json",
        slug: "file-json-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file-md",
        slug: "file-md-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file-txt",
        slug: "file-txt-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file-png",
        slug: "file-png-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file-jpg",
        slug: "file-jpg-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file-gif",
        slug: "file-gif-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "analyse",
        slug: "analyse-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "book-open",
        slug: "book-open-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "plane-take-off",
        slug: "plane-take-off-solid",
        category_id: 121,
        type_of_icon: "SOLID",
        term: ["flight", "fly"]
    },
    {
        name: "plane-land",
        slug: "plane-land-solid",
        category_id: 121,
        type_of_icon: "SOLID",
        term: ["flight", "fly", "landing"]
    },
    {
        name: "parking",
        slug: "parking-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "id-card",
        slug: "id-card-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "adjust-alt",
        slug: "adjust-alt-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "landscape",
        slug: "landscape-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "landscape",
        slug: "landscape-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "traffic",
        slug: "traffic-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "comment",
        slug: "comment-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "comment",
        slug: "comment-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "comment-dots",
        slug: "comment-dots-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["loading", "message", "chat"]
    },
    {
        name: "comment-dots",
        slug: "comment-dots-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["loading", "message", "chat"]
    },
    {
        name: "wine",
        slug: "wine-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "pyramid",
        slug: "pyramid-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "pyramid",
        slug: "pyramid-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "cylinder",
        slug: "cylinder-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "cylinder",
        slug: "cylinder-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "graduation",
        slug: "graduation-solid",
        category_id: 124,
        type_of_icon: "SOLID",
        term: ["scholar", "college"]
    },
    {
        name: "lock-alt",
        slug: "lock-alt-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "lock-alt",
        slug: "lock-alt-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "lock-open-alt",
        slug: "lock-open-alt-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "lock-open-alt",
        slug: "lock-open-alt-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "hourglass-top",
        slug: "hourglass-top-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "hourglass-bottom",
        slug: "hourglass-bottom-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "left-arrow-alt",
        slug: "left-arrow-alt-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "right-arrow-alt",
        slug: "right-arrow-alt-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "up-arrow-alt",
        slug: "up-arrow-alt-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "down-arrow-alt",
        slug: "down-arrow-alt-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "shape-circle",
        slug: "shape-circle-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "cycling",
        slug: "cycling-regular",
        category_id: 119,
        type_of_icon: "REGULAR"
    },
    {
        name: "dna",
        slug: "dna-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "bowling-ball",
        slug: "bowling-ball-regular",
        category_id: 119,
        type_of_icon: "REGULAR"
    },
    {
        name: "bowling-ball",
        slug: "bowling-ball-solid",
        category_id: 119,
        type_of_icon: "SOLID"
    },
    {
        name: "search-alt-2",
        slug: "search-alt-2-regular",
        category_id: 110,
        type_of_icon: "REGULAR",
        term: ["magnifying glass"]
    },
    {
        name: "search-alt-2",
        slug: "search-alt-2-solid",
        category_id: 110,
        type_of_icon: "SOLID",
        term: ["magnifying glass"]
    },
    {
        name: "plus-medical",
        slug: "plus-medical-regular",
        category_id: 109,
        type_of_icon: "REGULAR",
        term: ["hospital", "doctor", "medicine"]
    },
    {
        name: "street-view",
        slug: "street-view-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "droplet",
        slug: "droplet-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "droplet-half",
        slug: "droplet-half-solid",
        category_id: 102,
        type_of_icon: "SOLID"
    },
    {
        name: "paint-roll",
        slug: "paint-roll-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "paint-roll",
        slug: "paint-roll-solid",
        category_id: 102,
        type_of_icon: "SOLID"
    },
    {
        name: "shield-alt-2",
        slug: "shield-alt-2-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "shield-alt-2",
        slug: "shield-alt-2-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "error-alt",
        slug: "error-alt-regular",
        category_id: 95,
        type_of_icon: "REGULAR"
    },
    {
        name: "error-alt",
        slug: "error-alt-solid",
        category_id: 95,
        type_of_icon: "SOLID"
    },
    {
        name: "square",
        slug: "square-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "square",
        slug: "square-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "square-rounded",
        slug: "square-rounded-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "square-rounded",
        slug: "square-rounded-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "polygon",
        slug: "polygon-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "polygon",
        slug: "polygon-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "cube-alt",
        slug: "cube-alt-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "cube-alt",
        slug: "cube-alt-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "cuboid",
        slug: "cuboid-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "cuboid",
        slug: "cuboid-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "user-voice",
        slug: "user-voice-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "user-voice",
        slug: "user-voice-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "accessibility",
        slug: "accessibility-regular",
        category_id: 94,
        type_of_icon: "REGULAR",
        term: ["handicap", "wheelchair", "injury"]
    },
    {
        name: "building-house",
        slug: "building-house-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "building-house",
        slug: "building-house-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "doughnut-chart",
        slug: "doughnut-chart-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "doughnut-chart",
        slug: "doughnut-chart-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "circle",
        slug: "circle-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "log-in-circle",
        slug: "log-in-circle-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "log-in-circle",
        slug: "log-in-circle-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "log-out-circle",
        slug: "log-out-circle-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "log-out-circle",
        slug: "log-out-circle-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "log-in",
        slug: "log-in-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "log-out",
        slug: "log-out-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "notification",
        slug: "notification-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "notification-off",
        slug: "notification-off-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "check-square",
        slug: "check-square-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "check-square",
        slug: "check-square-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "message-alt",
        slug: "message-alt-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-alt",
        slug: "message-alt-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-alt-dots",
        slug: "message-alt-dots-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["loading", "chat", "comment"]
    },
    {
        name: "message-alt-dots",
        slug: "message-alt-dots-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["loading", "chat", "comment"]
    },
    {
        name: "no-entry",
        slug: "no-entry-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "no-entry",
        slug: "no-entry-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "traffic-barrier",
        slug: "traffic-barrier-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "component",
        slug: "component-solid",
        category_id: 100,
        type_of_icon: "SOLID"
    },
    {
        name: "plane-alt",
        slug: "plane-alt-solid",
        category_id: 121,
        type_of_icon: "SOLID",
        term: ["flight", "fly"]
    },
    {
        name: "palette",
        slug: "palette-regular",
        category_id: 102,
        type_of_icon: "REGULAR",
        term: ["color", "colour", "painting"]
    },
    {
        name: "palette",
        slug: "palette-solid",
        category_id: 102,
        type_of_icon: "SOLID",
        term: ["color", "colour", "painting"]
    },
    {
        name: "basket",
        slug: "basket-regular",
        category_id: 104,
        type_of_icon: "REGULAR"
    },
    {
        name: "basket",
        slug: "basket-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "purchase-tag-alt",
        slug: "purchase-tag-alt-regular",
        category_id: 104,
        type_of_icon: "REGULAR",
        term: ["price", "cost"]
    },
    {
        name: "purchase-tag-alt",
        slug: "purchase-tag-alt-solid",
        category_id: 104,
        type_of_icon: "SOLID",
        term: ["price", "cost"]
    },
    {
        name: "receipt",
        slug: "receipt-regular",
        category_id: 104,
        type_of_icon: "REGULAR"
    },
    {
        name: "receipt",
        slug: "receipt-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "line-chart",
        slug: "line-chart-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "map-pin",
        slug: "map-pin-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "map-pin",
        slug: "map-pin-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "hive",
        slug: "hive-regular",
        category_id: 113,
        type_of_icon: "REGULAR"
    },
    {
        name: "band-aid",
        slug: "band-aid-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "band-aid",
        slug: "band-aid-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "credit-card-alt",
        slug: "credit-card-alt-regular",
        category_id: 107,
        type_of_icon: "REGULAR",
        term: ["finance", "money", "debit"]
    },
    {
        name: "credit-card-alt",
        slug: "credit-card-alt-solid",
        category_id: 107,
        type_of_icon: "SOLID",
        term: ["finance", "money", "debit"]
    },
    {
        name: "credit-card",
        slug: "credit-card-solid",
        category_id: 107,
        type_of_icon: "SOLID",
        term: ["finance", "money", "debit"]
    },
    {
        name: "wifi-off",
        slug: "wifi-off-regular",
        category_id: 115,
        type_of_icon: "REGULAR"
    },
    {
        name: "paint",
        slug: "paint-solid",
        category_id: 102,
        type_of_icon: "SOLID"
    },
    {
        name: "brightness-half",
        slug: "brightness-half-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "brightness-half",
        slug: "brightness-half-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "brightness",
        slug: "brightness-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "brightness",
        slug: "brightness-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "filter-alt",
        slug: "filter-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "dialpad-alt",
        slug: "dialpad-alt-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["keypad"]
    },
    {
        name: "border-right",
        slug: "border-right-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "border-left",
        slug: "border-left-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "border-top",
        slug: "border-top-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "border-bottom",
        slug: "border-bottom-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "border-all",
        slug: "border-all-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "mobile-landscape",
        slug: "mobile-landscape-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "mobile-vibration",
        slug: "mobile-vibration-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "rectangle",
        slug: "rectangle-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "right-arrow",
        slug: "right-arrow-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "left-arrow",
        slug: "left-arrow-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "up-arrow",
        slug: "up-arrow-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "down-arrow",
        slug: "down-arrow-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "right-top-arrow-circle",
        slug: "right-top-arrow-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "right-down-arrow-circle",
        slug: "right-down-arrow-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "left-top-arrow-circle",
        slug: "left-top-arrow-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "left-down-arrow-circle",
        slug: "left-down-arrow-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "institution",
        slug: "institution-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "school",
        slug: "school-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "chalkboard",
        slug: "chalkboard-solid",
        category_id: 99,
        type_of_icon: "SOLID",
        term: ["whiteboard", "teaching"]
    },
    {
        name: "skip-previous-circle",
        slug: "skip-previous-circle-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "skip-next-circle",
        slug: "skip-next-circle-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "data",
        slug: "data-solid",
        category_id: 100,
        type_of_icon: "SOLID"
    },
    {
        name: "mobile",
        slug: "mobile-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "folder-minus",
        slug: "folder-minus-solid",
        category_id: 106,
        type_of_icon: "SOLID",
        term: ["remove", "delete"]
    },
    {
        name: "bell-plus",
        slug: "bell-plus-solid",
        category_id: 95,
        type_of_icon: "SOLID",
        term: ["alert", "notification"]
    },
    {
        name: "bell-minus",
        slug: "bell-minus-solid",
        category_id: 95,
        type_of_icon: "SOLID",
        term: ["alert", "notification"]
    },
    {
        name: "search",
        slug: "search-solid",
        category_id: 110,
        type_of_icon: "SOLID",
        term: ["magnifying glass"]
    },
    {
        name: "zoom-in",
        slug: "zoom-in-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "zoom-out",
        slug: "zoom-out-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "grid",
        slug: "grid-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "user-x",
        slug: "user-x-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "user-check",
        slug: "user-check-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "compass",
        slug: "compass-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "gas-pump",
        slug: "gas-pump-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "stopwatch",
        slug: "stopwatch-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "timer",
        slug: "timer-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "time",
        slug: "time-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "pie-chart-alt-2",
        slug: "pie-chart-alt-2-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "pie-chart-alt-2",
        slug: "pie-chart-alt-2-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "time-five",
        slug: "time-five-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "time-five",
        slug: "time-five-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "instagram-alt",
        slug: "instagram-alt-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["social media"]
    },
    {
        name: "bookmarks",
        slug: "bookmarks-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "bookmark-minus",
        slug: "bookmark-minus-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "briefcase-alt-2",
        slug: "briefcase-alt-2-regular",
        category_id: 99,
        type_of_icon: "REGULAR",
        term: ["work", "travel", "suitcase"]
    },
    {
        name: "briefcase-alt-2",
        slug: "briefcase-alt-2-solid",
        category_id: 99,
        type_of_icon: "SOLID",
        term: ["work", "travel", "suitcase"]
    },
    {
        name: "brush-alt",
        slug: "brush-alt-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar",
        slug: "calendar-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-alt",
        slug: "calendar-alt-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-plus",
        slug: "calendar-plus-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-minus",
        slug: "calendar-minus-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-x",
        slug: "calendar-x-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-check",
        slug: "calendar-check-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-event",
        slug: "calendar-event-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "customize",
        slug: "customize-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "customize",
        slug: "customize-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "carousel",
        slug: "carousel-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "rewind-circle",
        slug: "rewind-circle-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "fast-forward-circle",
        slug: "fast-forward-circle-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "mobile-vibration",
        slug: "mobile-vibration-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "quote-alt-left",
        slug: "quote-alt-left-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "quote-alt-right",
        slug: "quote-alt-right-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "layout",
        slug: "layout-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "radio",
        slug: "radio-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "printer",
        slug: "printer-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "sort-a-z",
        slug: "sort-a-z-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "sort-z-a",
        slug: "sort-z-a-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "conversation",
        slug: "conversation-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "discussion"]
    },
    {
        name: "brush-alt",
        slug: "brush-alt-solid",
        category_id: 102,
        type_of_icon: "SOLID"
    },
    {
        name: "exit",
        slug: "exit-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "exit",
        slug: "exit-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "extension",
        slug: "extension-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "extension",
        slug: "extension-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "file-find",
        slug: "file-find-solid",
        category_id: 106,
        type_of_icon: "SOLID",
        term: ["search"]
    },
    {
        name: "face",
        slug: "face-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "face",
        slug: "face-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "file-find",
        slug: "file-find-regular",
        category_id: 106,
        type_of_icon: "REGULAR",
        term: ["search"]
    },
    {
        name: "label",
        slug: "label-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "label",
        slug: "label-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "check-shield",
        slug: "check-shield-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "check-shield",
        slug: "check-shield-solid",
        category_id: 100,
        type_of_icon: "SOLID"
    },
    {
        name: "border-radius",
        slug: "border-radius-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "add-to-queue",
        slug: "add-to-queue-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "add-to-queue",
        slug: "add-to-queue-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "archive-in",
        slug: "archive-in-regular",
        category_id: 106,
        type_of_icon: "REGULAR"
    },
    {
        name: "archive-in",
        slug: "archive-in-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "archive-out",
        slug: "archive-out-regular",
        category_id: 106,
        type_of_icon: "REGULAR"
    },
    {
        name: "archive-out",
        slug: "archive-out-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "alarm-add",
        slug: "alarm-add-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "alarm-add",
        slug: "alarm-add-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "space-bar",
        slug: "space-bar-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "image-alt",
        slug: "image-alt-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "image-add",
        slug: "image-add-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "image-add",
        slug: "image-add-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "fridge",
        slug: "fridge-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "fridge",
        slug: "fridge-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "dish",
        slug: "dish-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "dish",
        slug: "dish-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "spa",
        slug: "spa-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "spa",
        slug: "spa-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "cake",
        slug: "cake-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "cake",
        slug: "cake-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "city",
        slug: "city-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "bolt-circle",
        slug: "bolt-circle-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "bolt-circle",
        slug: "bolt-circle-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "tone",
        slug: "tone-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "bitcoin",
        slug: "bitcoin-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "lira",
        slug: "lira-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "ruble",
        slug: "ruble-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-up-circle",
        slug: "caret-up-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "caret-down-circle",
        slug: "caret-down-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "caret-left-circle",
        slug: "caret-left-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "caret-right-circle",
        slug: "caret-right-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "rupee",
        slug: "rupee-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "euro",
        slug: "euro-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "pound",
        slug: "pound-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "won",
        slug: "won-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "yen",
        slug: "yen-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "shekel",
        slug: "shekel-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "facebook-circle",
        slug: "facebook-circle-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["social media"]
    },
    {
        name: "jquery",
        slug: "jquery-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "imdb",
        slug: "imdb-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "pinterest-alt",
        slug: "pinterest-alt-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "tone",
        slug: "tone-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "health",
        slug: "health-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "baby-carriage",
        slug: "baby-carriage-solid",
        category_id: 94,
        type_of_icon: "SOLID",
        term: ["child", "pregnancy", "birth"]
    },
    {
        name: "clinic",
        slug: "clinic-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "hand-up",
        slug: "hand-up-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["finger", "point", "direction"]
    },
    {
        name: "hand-right",
        slug: "hand-right-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["finger", "point", "direction"]
    },
    {
        name: "hand-down",
        slug: "hand-down-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["finger", "point", "direction"]
    },
    {
        name: "hand-left",
        slug: "hand-left-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["finger", "point", "direction"]
    },
    {
        name: "male",
        slug: "male-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "female",
        slug: "female-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "male-sign",
        slug: "male-sign-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "female-sign",
        slug: "female-sign-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "clinic",
        slug: "clinic-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "offer",
        slug: "offer-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "food-tag",
        slug: "food-tag-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "food-menu",
        slug: "food-menu-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "food-menu",
        slug: "food-menu-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "camera-plus",
        slug: "camera-plus-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "business",
        slug: "business-solid",
        category_id: 98,
        type_of_icon: "SOLID",
        term: ["skyline", "skyscraper", "city"]
    },
    {
        name: "meh-alt",
        slug: "meh-alt-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "wink-tongue",
        slug: "wink-tongue-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "happy-alt",
        slug: "happy-alt-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "cool",
        slug: "cool-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "tired",
        slug: "tired-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "smile",
        slug: "smile-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "angry",
        slug: "angry-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "happy-heart-eyes",
        slug: "happy-heart-eyes-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "dizzy",
        slug: "dizzy-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "wink-smile",
        slug: "wink-smile-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "confused",
        slug: "confused-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "sleepy",
        slug: "sleepy-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "shocked",
        slug: "shocked-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "happy-beaming",
        slug: "happy-beaming-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "meh-blank",
        slug: "meh-blank-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "laugh",
        slug: "laugh-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "upside-down",
        slug: "upside-down-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "angry",
        slug: "angry-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "happy-heart-eyes",
        slug: "happy-heart-eyes-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "dizzy",
        slug: "dizzy-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "wink-smile",
        slug: "wink-smile-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "smile",
        slug: "smile-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "meh",
        slug: "meh-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "meh-alt",
        slug: "meh-alt-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "confused",
        slug: "confused-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "sleepy",
        slug: "sleepy-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "sad",
        slug: "sad-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "happy",
        slug: "happy-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "shocked",
        slug: "shocked-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "happy-beaming",
        slug: "happy-beaming-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "tired",
        slug: "tired-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "cool",
        slug: "cool-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "meh-blank",
        slug: "meh-blank-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "laugh",
        slug: "laugh-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "happy-alt",
        slug: "happy-alt-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "upside-down",
        slug: "upside-down-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "wink-tongue",
        slug: "wink-tongue-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "adobe",
        slug: "adobe-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "algolia",
        slug: "algolia-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "audible",
        slug: "audible-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "figma",
        slug: "figma-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "etsy",
        slug: "etsy-logo",
        category_id: 104,
        type_of_icon: "LOGO"
    },
    {
        name: "gitlab",
        slug: "gitlab-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "patreon",
        slug: "patreon-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "redbubble",
        slug: "redbubble-logo",
        category_id: 104,
        type_of_icon: "LOGO"
    },
    {
        name: "diamond",
        slug: "diamond-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "comment-error",
        slug: "comment-error-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "vial",
        slug: "vial-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "align-left",
        slug: "align-left-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "align-middle",
        slug: "align-middle-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "align-right",
        slug: "align-right-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-back",
        slug: "arrow-back-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "bell-minus",
        slug: "bell-minus-regular",
        category_id: 95,
        type_of_icon: "REGULAR",
        term: ["alert", "notification"]
    },
    {
        name: "bell-off",
        slug: "bell-off-regular",
        category_id: 95,
        type_of_icon: "REGULAR",
        term: ["alert", "notification", "silent"]
    },
    {
        name: "bell-plus",
        slug: "bell-plus-regular",
        category_id: 95,
        type_of_icon: "REGULAR",
        term: ["alert", "notification"]
    },
    {
        name: "bell",
        slug: "bell-regular",
        category_id: 95,
        type_of_icon: "REGULAR",
        term: ["alert", "notification"]
    },
    {
        name: "bookmark",
        slug: "bookmark-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "bookmarks",
        slug: "bookmarks-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "bullseye",
        slug: "bullseye-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "camera-off",
        slug: "camera-off-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "camera",
        slug: "camera-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "captions",
        slug: "captions-regular",
        category_id: 94,
        type_of_icon: "REGULAR",
        term: ["subtitles", "subs", "cc"]
    },
    {
        name: "checkbox-checked",
        slug: "checkbox-checked-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "checkbox",
        slug: "checkbox-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "checkbox-square",
        slug: "checkbox-square-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-down",
        slug: "chevron-down-regular",
        category_id: 96,
        type_of_icon: "REGULAR",
        term: ["arrow"]
    },
    {
        name: "chevron-up",
        slug: "chevron-up-regular",
        category_id: 96,
        type_of_icon: "REGULAR",
        term: ["arrow"]
    },
    {
        name: "chevron-left",
        slug: "chevron-left-regular",
        category_id: 96,
        type_of_icon: "REGULAR",
        term: ["arrow"]
    },
    {
        name: "chevron-right",
        slug: "chevron-right-regular",
        category_id: 96,
        type_of_icon: "REGULAR",
        term: ["arrow"]
    },
    {
        name: "chevrons-down",
        slug: "chevrons-down-regular",
        category_id: 96,
        type_of_icon: "REGULAR",
        term: ["arrow"]
    },
    {
        name: "chevrons-up",
        slug: "chevrons-up-regular",
        category_id: 96,
        type_of_icon: "REGULAR",
        term: ["arrow"]
    },
    {
        name: "chevrons-right",
        slug: "chevrons-right-regular",
        category_id: 96,
        type_of_icon: "REGULAR",
        term: ["arrow"]
    },
    {
        name: "chevrons-left",
        slug: "chevrons-left-regular",
        category_id: 96,
        type_of_icon: "REGULAR",
        term: ["arrow"]
    },
    {
        name: "clipboard",
        slug: "clipboard-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "code-curly",
        slug: "code-curly-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "code",
        slug: "code-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "coffee",
        slug: "coffee-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "copy",
        slug: "copy-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "copyright",
        slug: "copyright-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "down-arrow-circle",
        slug: "down-arrow-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "error-circle",
        slug: "error-circle-regular",
        category_id: 95,
        type_of_icon: "REGULAR"
    },
    {
        name: "error",
        slug: "error-regular",
        category_id: 95,
        type_of_icon: "REGULAR"
    },
    {
        name: "exit-fullscreen",
        slug: "exit-fullscreen-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "fast-forward-circle",
        slug: "fast-forward-circle-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "fast-forward",
        slug: "fast-forward-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "first-page",
        slug: "first-page-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "folder-minus",
        slug: "folder-minus-regular",
        category_id: 106,
        type_of_icon: "REGULAR",
        term: ["remove", "delete"]
    },
    {
        name: "folder-plus",
        slug: "folder-plus-regular",
        category_id: 106,
        type_of_icon: "REGULAR",
        term: ["add", "folder add", "new folder"]
    },
    {
        name: "folder",
        slug: "folder-regular",
        category_id: 106,
        type_of_icon: "REGULAR"
    },
    {
        name: "fullscreen",
        slug: "fullscreen-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "hide",
        slug: "hide-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "image",
        slug: "image-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "info-circle",
        slug: "info-circle-regular",
        category_id: 94,
        type_of_icon: "REGULAR"
    },
    {
        name: "align-justify",
        slug: "align-justify-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "key",
        slug: "key-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "last-page",
        slug: "last-page-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "left-arrow-circle",
        slug: "left-arrow-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "left-down-arrow-circle",
        slug: "left-down-arrow-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "left-indent",
        slug: "left-indent-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "left-top-arrow-circle",
        slug: "left-top-arrow-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "menu",
        slug: "menu-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "microphone",
        slug: "microphone-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "minus-circle",
        slug: "minus-circle-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "moon",
        slug: "moon-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "pause-circle",
        slug: "pause-circle-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "pause",
        slug: "pause-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "play-circle",
        slug: "play-circle-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "play",
        slug: "play-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "plus-circle",
        slug: "plus-circle-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "question-mark",
        slug: "question-mark-regular",
        category_id: 94,
        type_of_icon: "REGULAR"
    },
    {
        name: "radio-circle-marked",
        slug: "radio-circle-marked-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "radio-circle",
        slug: "radio-circle-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "rectangle",
        slug: "rectangle-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "rewind",
        slug: "rewind-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "reset",
        slug: "reset-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "right-arrow-circle",
        slug: "right-arrow-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "right-down-arrow-circle",
        slug: "right-down-arrow-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "right-indent",
        slug: "right-indent-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "right-top-arrow-circle",
        slug: "right-top-arrow-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "rss",
        slug: "rss-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "search",
        slug: "search-regular",
        category_id: 110,
        type_of_icon: "REGULAR",
        term: ["magnifying glass"]
    },
    {
        name: "show",
        slug: "show-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "skip-next",
        slug: "skip-next-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "skip-previous",
        slug: "skip-previous-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "stop-circle",
        slug: "stop-circle-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "stop",
        slug: "stop-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "stopwatch",
        slug: "stopwatch-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "sync",
        slug: "sync-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "time",
        slug: "time-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "toggle-left",
        slug: "toggle-left-regular",
        category_id: 110,
        type_of_icon: "REGULAR",
        term: ["switch"]
    },
    {
        name: "toggle-right",
        slug: "toggle-right-regular",
        category_id: 110,
        type_of_icon: "REGULAR",
        term: ["switch"]
    },
    {
        name: "trending-down",
        slug: "trending-down-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "trending-up",
        slug: "trending-up-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "up-arrow-circle",
        slug: "up-arrow-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "vertical-center",
        slug: "vertical-center-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "video",
        slug: "video-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "volume-full",
        slug: "volume-full-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "volume-low",
        slug: "volume-low-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "volume-mute",
        slug: "volume-mute-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "volume",
        slug: "volume-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "x-circle",
        slug: "x-circle-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "zoom-in",
        slug: "zoom-in-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "zoom-out",
        slug: "zoom-out-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "archive",
        slug: "archive-regular",
        category_id: 106,
        type_of_icon: "REGULAR"
    },
    {
        name: "at",
        slug: "at-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "bar-chart-alt",
        slug: "bar-chart-alt-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "bar-chart-square",
        slug: "bar-chart-square-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "bar-chart",
        slug: "bar-chart-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "basketball",
        slug: "basketball-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["nba"]
    },
    {
        name: "block",
        slug: "block-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "book-bookmark",
        slug: "book-bookmark-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "book",
        slug: "book-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "bookmark-minus",
        slug: "bookmark-minus-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "bookmark-plus",
        slug: "bookmark-plus-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "briefcase",
        slug: "briefcase-regular",
        category_id: 99,
        type_of_icon: "REGULAR",
        term: ["work", "travel", "suitcase"]
    },
    {
        name: "broadcast",
        slug: "broadcast-regular",
        category_id: 115,
        type_of_icon: "REGULAR"
    },
    {
        name: "building",
        slug: "building-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "bug",
        slug: "bug-regular",
        category_id: 100,
        type_of_icon: "REGULAR",
        term: ["error", "warning"]
    },
    {
        name: "bluetooth",
        slug: "bluetooth-regular",
        category_id: 115,
        type_of_icon: "REGULAR"
    },
    {
        name: "bulb",
        slug: "bulb-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "buoy",
        slug: "buoy-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-plus",
        slug: "calendar-plus-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-check",
        slug: "calendar-check-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-minus",
        slug: "calendar-minus-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-x",
        slug: "calendar-x-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar",
        slug: "calendar-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "chart",
        slug: "chart-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "cloud-download",
        slug: "cloud-download-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "cloud-upload",
        slug: "cloud-upload-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "cloud",
        slug: "cloud-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "terminal",
        slug: "terminal-regular",
        category_id: 100,
        type_of_icon: "REGULAR",
        term: ["command line"]
    },
    {
        name: "crosshair",
        slug: "crosshair-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "compass",
        slug: "compass-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "data",
        slug: "data-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "desktop",
        slug: "desktop-regular",
        category_id: 103,
        type_of_icon: "REGULAR",
        term: ["monitor", "display"]
    },
    {
        name: "directions",
        slug: "directions-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "dollar",
        slug: "dollar-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "dots-horizontal-rounded",
        slug: "dots-horizontal-rounded-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "dots-horizontal",
        slug: "dots-horizontal-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "dots-vertical-rounded",
        slug: "dots-vertical-rounded-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "dots-vertical",
        slug: "dots-vertical-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "download",
        slug: "download-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "envelope",
        slug: "envelope-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["letter", "mail", "email", "communication"]
    },
    {
        name: "gift",
        slug: "gift-regular",
        category_id: 104,
        type_of_icon: "REGULAR"
    },
    {
        name: "globe",
        slug: "globe-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "devices",
        slug: "devices-regular",
        category_id: 103,
        type_of_icon: "REGULAR",
        term: ["mobile", "tab"]
    },
    {
        name: "headphone",
        slug: "headphone-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "heart",
        slug: "heart-regular",
        category_id: 109,
        type_of_icon: "REGULAR",
        term: ["health"]
    },
    {
        name: "home",
        slug: "home-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "laptop",
        slug: "laptop-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "layer",
        slug: "layer-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "link-alt",
        slug: "link-alt-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "link",
        slug: "link-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "list-plus",
        slug: "list-plus-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "list-ul",
        slug: "list-ul-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "list-minus",
        slug: "list-minus-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "lock-open",
        slug: "lock-open-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "lock",
        slug: "lock-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "map-alt",
        slug: "map-alt-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "map",
        slug: "map-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-rounded",
        slug: "message-rounded-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message",
        slug: "message-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "mobile-alt",
        slug: "mobile-alt-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "mobile",
        slug: "mobile-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "navigation",
        slug: "navigation-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "phone",
        slug: "phone-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "pie-chart",
        slug: "pie-chart-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "send",
        slug: "send-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "sidebar",
        slug: "sidebar-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "sitemap",
        slug: "sitemap-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "spreadsheet",
        slug: "spreadsheet-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "tab",
        slug: "tab-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "tag",
        slug: "tag-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "target-lock",
        slug: "target-lock-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "tennis-ball",
        slug: "tennis-ball-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["deuce"]
    },
    {
        name: "alarm",
        slug: "alarm-regular",
        category_id: 120,
        type_of_icon: "REGULAR",
        term: ["alert"]
    },
    {
        name: "upload",
        slug: "upload-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "usb",
        slug: "usb-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "video-off",
        slug: "video-off-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "voicemail",
        slug: "voicemail-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "wifi",
        slug: "wifi-regular",
        category_id: 115,
        type_of_icon: "REGULAR"
    },
    {
        name: "window-open",
        slug: "window-open-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "window",
        slug: "window-regular",
        category_id: 110,
        type_of_icon: "REGULAR",
        term: ["browser"]
    },
    {
        name: "windows",
        slug: "windows-regular",
        category_id: 110,
        type_of_icon: "REGULAR",
        term: ["browser"]
    },
    {
        name: "duplicate",
        slug: "duplicate-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "table",
        slug: "table-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "x",
        slug: "x-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "adjust",
        slug: "adjust-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "album",
        slug: "album-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "anchor",
        slug: "anchor-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "award",
        slug: "award-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "bold",
        slug: "bold-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "calculator",
        slug: "calculator-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "cart",
        slug: "cart-regular",
        category_id: 104,
        type_of_icon: "REGULAR"
    },
    {
        name: "check",
        slug: "check-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "cloud-drizzle",
        slug: "cloud-drizzle-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "cloud-light-rain",
        slug: "cloud-light-rain-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "cloud-lightning",
        slug: "cloud-lightning-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "cloud-rain",
        slug: "cloud-rain-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "cloud-snow",
        slug: "cloud-snow-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "cog",
        slug: "cog-regular",
        category_id: 110,
        type_of_icon: "REGULAR",
        term: ["gear", "setting"]
    },
    {
        name: "columns",
        slug: "columns-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "credit-card",
        slug: "credit-card-regular",
        category_id: 107,
        type_of_icon: "REGULAR",
        term: ["finance", "money", "debit"]
    },
    {
        name: "crop",
        slug: "crop-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "cube",
        slug: "cube-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "cut",
        slug: "cut-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "detail",
        slug: "detail-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "shield-quarter",
        slug: "shield-quarter-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "edit",
        slug: "edit-regular",
        category_id: 124,
        type_of_icon: "REGULAR",
        term: ["writing", "note", "pencil"]
    },
    {
        name: "file",
        slug: "file-regular",
        category_id: 106,
        type_of_icon: "REGULAR"
    },
    {
        name: "filter",
        slug: "filter-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "font",
        slug: "font-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "git-branch",
        slug: "git-branch-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "git-commit",
        slug: "git-commit-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "git-compare",
        slug: "git-compare-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "git-merge",
        slug: "git-merge-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "git-pull-request",
        slug: "git-pull-request-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "git-repo-forked",
        slug: "git-repo-forked-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "group",
        slug: "group-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "hash",
        slug: "hash-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "heading",
        slug: "heading-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "home-alt",
        slug: "home-alt-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "italic",
        slug: "italic-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "joystick",
        slug: "joystick-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "link-external",
        slug: "link-external-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "log-in",
        slug: "log-in-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "log-out",
        slug: "log-out-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "microphone-off",
        slug: "microphone-off-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "minus",
        slug: "minus-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "mouse",
        slug: "mouse-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "move",
        slug: "move-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "music",
        slug: "music-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "notification",
        slug: "notification-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "package",
        slug: "package-regular",
        category_id: 104,
        type_of_icon: "REGULAR",
        term: ["box", "shipping", "delivery"]
    },
    {
        name: "paragraph",
        slug: "paragraph-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "paste",
        slug: "paste-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "pencil",
        slug: "pencil-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "pin",
        slug: "pin-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "plus",
        slug: "plus-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "power-off",
        slug: "power-off-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "pulse",
        slug: "pulse-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "save",
        slug: "save-regular",
        category_id: 116,
        type_of_icon: "REGULAR",
        term: ["floppy disk"]
    },
    {
        name: "screenshot",
        slug: "screenshot-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "select-multiple",
        slug: "select-multiple-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "share-alt",
        slug: "share-alt-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "share",
        slug: "share-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "shield-alt",
        slug: "shield-alt-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "shield",
        slug: "shield-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "shopping-bag",
        slug: "shopping-bag-regular",
        category_id: 104,
        type_of_icon: "REGULAR"
    },
    {
        name: "shuffle",
        slug: "shuffle-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "sort",
        slug: "sort-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "star",
        slug: "star-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "sun",
        slug: "sun-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "text",
        slug: "text-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "trash",
        slug: "trash-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "trophy",
        slug: "trophy-regular",
        category_id: 119,
        type_of_icon: "REGULAR"
    },
    {
        name: "underline",
        slug: "underline-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "user-check",
        slug: "user-check-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "user-circle",
        slug: "user-circle-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "user-minus",
        slug: "user-minus-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "user-plus",
        slug: "user-plus-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "user-x",
        slug: "user-x-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "user",
        slug: "user-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "barcode",
        slug: "barcode-regular",
        category_id: 104,
        type_of_icon: "REGULAR"
    },
    {
        name: "crown",
        slug: "crown-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "dislike",
        slug: "dislike-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "down-arrow",
        slug: "down-arrow-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "export",
        slug: "export-regular",
        category_id: 106,
        type_of_icon: "REGULAR"
    },
    {
        name: "facebook",
        slug: "facebook-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["social media"]
    },
    {
        name: "first-aid",
        slug: "first-aid-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "flag",
        slug: "flag-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "github",
        slug: "github-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "google",
        slug: "google-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "history",
        slug: "history-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "instagram",
        slug: "instagram-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["social media"]
    },
    {
        name: "joystick-alt",
        slug: "joystick-alt-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "left-arrow",
        slug: "left-arrow-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "like",
        slug: "like-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "list-check",
        slug: "list-check-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "poll",
        slug: "poll-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "radar",
        slug: "radar-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "redo",
        slug: "redo-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "reply-all",
        slug: "reply-all-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "reply",
        slug: "reply-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "repost",
        slug: "repost-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "revision",
        slug: "revision-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "right-arrow",
        slug: "right-arrow-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "subdirectory-left",
        slug: "subdirectory-left-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "subdirectory-right",
        slug: "subdirectory-right-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "support",
        slug: "support-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "timer",
        slug: "timer-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "twitter",
        slug: "twitter-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["social media"]
    },
    {
        name: "undo",
        slug: "undo-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "up-arrow",
        slug: "up-arrow-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "youtube",
        slug: "youtube-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "whatsapp",
        slug: "whatsapp-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "tumblr",
        slug: "tumblr-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "phone-call",
        slug: "phone-call-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "behance",
        slug: "behance-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "dribbble",
        slug: "dribbble-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "aperture",
        slug: "aperture-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "film",
        slug: "film-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "folder-open",
        slug: "folder-open-regular",
        category_id: 106,
        type_of_icon: "REGULAR"
    },
    {
        name: "task",
        slug: "task-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "server",
        slug: "server-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "battery",
        slug: "battery-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-alt",
        slug: "calendar-alt-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "import",
        slug: "import-regular",
        category_id: 106,
        type_of_icon: "REGULAR"
    },
    {
        name: "ruler",
        slug: "ruler-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "horizontal-center",
        slug: "horizontal-center-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "rotate-right",
        slug: "rotate-right-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "rename",
        slug: "rename-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "collapse",
        slug: "collapse-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "phone-incoming",
        slug: "phone-incoming-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "phone-outgoing",
        slug: "phone-outgoing-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "body",
        slug: "body-regular",
        category_id: 94,
        type_of_icon: "REGULAR",
        term: ["male"]
    },
    {
        name: "cast",
        slug: "cast-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "chip",
        slug: "chip-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "skip-next-circle",
        slug: "skip-next-circle-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "skip-previous-circle",
        slug: "skip-previous-circle-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "hdd",
        slug: "hdd-regular",
        category_id: 103,
        type_of_icon: "REGULAR",
        term: ["storage", "hard drive"]
    },
    {
        name: "store",
        slug: "store-regular",
        category_id: 104,
        type_of_icon: "REGULAR",
        term: ["shop", "market"]
    },
    {
        name: "globe-alt",
        slug: "globe-alt-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "vimeo",
        slug: "vimeo-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "upvote",
        slug: "upvote-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "downvote",
        slug: "downvote-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "news",
        slug: "news-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "pie-chart-alt",
        slug: "pie-chart-alt-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "images",
        slug: "images-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "purchase-tag",
        slug: "purchase-tag-regular",
        category_id: 104,
        type_of_icon: "REGULAR",
        term: ["price", "cost"]
    },
    {
        name: "pen",
        slug: "pen-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "expand",
        slug: "expand-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "paperclip",
        slug: "paperclip-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "closet",
        slug: "closet-regular",
        category_id: 104,
        type_of_icon: "REGULAR"
    },
    {
        name: "tv",
        slug: "tv-regular",
        category_id: 103,
        type_of_icon: "REGULAR",
        term: ["television", "monitor"]
    },
    {
        name: "collection",
        slug: "collection-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "station",
        slug: "station-regular",
        category_id: 115,
        type_of_icon: "REGULAR"
    },
    {
        name: "wallet",
        slug: "wallet-regular",
        category_id: 107,
        type_of_icon: "REGULAR",
        term: ["money"]
    },
    {
        name: "briefcase-alt",
        slug: "briefcase-alt-regular",
        category_id: 99,
        type_of_icon: "REGULAR",
        term: ["work", "travel", "suitcase"]
    },
    {
        name: "hourglass",
        slug: "hourglass-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "carousel",
        slug: "carousel-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "infinite",
        slug: "infinite-regular",
        category_id: 113,
        type_of_icon: "REGULAR"
    },
    {
        name: "plug",
        slug: "plug-regular",
        category_id: 116,
        type_of_icon: "REGULAR",
        term: ["charging"]
    },
    {
        name: "notification-off",
        slug: "notification-off-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "window-close",
        slug: "window-close-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "command",
        slug: "command-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "grid-alt",
        slug: "grid-alt-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "trash-alt",
        slug: "trash-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "chalkboard",
        slug: "chalkboard-regular",
        category_id: 99,
        type_of_icon: "REGULAR",
        term: ["whiteboard", "teaching"]
    },
    {
        name: "loader",
        slug: "loader-regular",
        category_id: 112,
        type_of_icon: "REGULAR"
    },
    {
        name: "slider",
        slug: "slider-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "paper-plane",
        slug: "paper-plane-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "selection",
        slug: "selection-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "linkedin",
        slug: "linkedin-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "world",
        slug: "world-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "dock-bottom",
        slug: "dock-bottom-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "dock-right",
        slug: "dock-right-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "dock-top",
        slug: "dock-top-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "dock-left",
        slug: "dock-left-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "layout",
        slug: "layout-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "bitcoin",
        slug: "bitcoin-logo",
        category_id: 107,
        type_of_icon: "LOGO"
    },
    {
        name: "facebook-square",
        slug: "facebook-square-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "alarm-off",
        slug: "alarm-off-regular",
        category_id: 120,
        type_of_icon: "REGULAR",
        term: ["alert", "silent"]
    },
    {
        name: "wrench",
        slug: "wrench-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "loader-circle",
        slug: "loader-circle-regular",
        category_id: 112,
        type_of_icon: "REGULAR"
    },
    {
        name: "loader-alt",
        slug: "loader-alt-regular",
        category_id: 112,
        type_of_icon: "REGULAR"
    },
    {
        name: "car",
        slug: "car-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "cart-alt",
        slug: "cart-alt-regular",
        category_id: 104,
        type_of_icon: "REGULAR"
    },
    {
        name: "adjust",
        slug: "adjust-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "alarm",
        slug: "alarm-solid",
        category_id: 120,
        type_of_icon: "SOLID",
        term: ["alert"]
    },
    {
        name: "alarm-off",
        slug: "alarm-off-solid",
        category_id: 120,
        type_of_icon: "SOLID",
        term: ["alert", "silent"]
    },
    {
        name: "album",
        slug: "album-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "archive",
        slug: "archive-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "camera",
        slug: "camera-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "camera-off",
        slug: "camera-off-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "folder",
        slug: "folder-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "folder-plus",
        slug: "folder-plus-solid",
        category_id: 106,
        type_of_icon: "SOLID",
        term: ["add", "folder add", "new folder"]
    },
    {
        name: "award",
        slug: "award-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "bar-chart-square",
        slug: "bar-chart-square-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "barcode",
        slug: "barcode-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "battery",
        slug: "battery-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "battery-charging",
        slug: "battery-charging-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "battery-full",
        slug: "battery-full-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "bell",
        slug: "bell-solid",
        category_id: 95,
        type_of_icon: "SOLID",
        term: ["alert", "notification"]
    },
    {
        name: "bell-off",
        slug: "bell-off-solid",
        category_id: 95,
        type_of_icon: "SOLID",
        term: ["alert", "notification", "silent"]
    },
    {
        name: "bolt",
        slug: "bolt-solid",
        category_id: 123,
        type_of_icon: "SOLID",
        term: ["zap"]
    },
    {
        name: "book",
        slug: "book-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "book-bookmark",
        slug: "book-bookmark-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "bookmark",
        slug: "bookmark-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "bookmark-plus",
        slug: "bookmark-plus-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "book-open",
        slug: "book-open-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "bookmark-star",
        slug: "bookmark-star-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "briefcase",
        slug: "briefcase-solid",
        category_id: 99,
        type_of_icon: "SOLID",
        term: ["work", "travel", "suitcase"]
    },
    {
        name: "briefcase-alt",
        slug: "briefcase-alt-solid",
        category_id: 99,
        type_of_icon: "SOLID",
        term: ["work", "travel", "suitcase"]
    },
    {
        name: "bug",
        slug: "bug-solid",
        category_id: 100,
        type_of_icon: "SOLID",
        term: ["error", "warning"]
    },
    {
        name: "building",
        slug: "building-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "bulb",
        slug: "bulb-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "buoy",
        slug: "buoy-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "calculator",
        slug: "calculator-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "captions",
        slug: "captions-solid",
        category_id: 94,
        type_of_icon: "SOLID",
        term: ["subtitles", "subs", "cc"]
    },
    {
        name: "car",
        slug: "car-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "cart-alt",
        slug: "cart-alt-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "cart",
        slug: "cart-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "chart",
        slug: "chart-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "chip",
        slug: "chip-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "cloud-download",
        slug: "cloud-download-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "cloud-upload",
        slug: "cloud-upload-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "cloud",
        slug: "cloud-solid",
        category_id: 123,
        type_of_icon: "SOLID"
    },
    {
        name: "coffee",
        slug: "coffee-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "cog",
        slug: "cog-solid",
        category_id: 110,
        type_of_icon: "SOLID",
        term: ["gear", "setting"]
    },
    {
        name: "collection",
        slug: "collection-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "contact",
        slug: "contact-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "copy",
        slug: "copy-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "coupon",
        slug: "coupon-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "crown",
        slug: "crown-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "cube",
        slug: "cube-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "detail",
        slug: "detail-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "discount",
        slug: "discount-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "dislike",
        slug: "dislike-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "dock-bottom",
        slug: "dock-bottom-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "dock-left",
        slug: "dock-left-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "dock-right",
        slug: "dock-right-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "dock-top",
        slug: "dock-top-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "down-arrow-circle",
        slug: "down-arrow-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "download",
        slug: "download-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "downvote",
        slug: "downvote-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "drink",
        slug: "drink-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "droplet",
        slug: "droplet-solid",
        category_id: 123,
        type_of_icon: "SOLID"
    },
    {
        name: "duplicate",
        slug: "duplicate-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "eject",
        slug: "eject-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "envelope",
        slug: "envelope-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["letter", "mail", "email", "communication"]
    },
    {
        name: "error-circle",
        slug: "error-circle-solid",
        category_id: 95,
        type_of_icon: "SOLID"
    },
    {
        name: "error",
        slug: "error-solid",
        category_id: 95,
        type_of_icon: "SOLID"
    },
    {
        name: "file-image",
        slug: "file-image-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file",
        slug: "file-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "filter-alt",
        slug: "filter-alt-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "first-aid",
        slug: "first-aid-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "flag-alt",
        slug: "flag-alt-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "flag",
        slug: "flag-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "gift",
        slug: "gift-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "grid-alt",
        slug: "grid-alt-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "group",
        slug: "group-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "hdd",
        slug: "hdd-solid",
        category_id: 103,
        type_of_icon: "SOLID",
        term: ["storage", "hard drive"]
    },
    {
        name: "heart",
        slug: "heart-solid",
        category_id: 109,
        type_of_icon: "SOLID",
        term: ["health"]
    },
    {
        name: "hide",
        slug: "hide-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "home",
        slug: "home-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "hot",
        slug: "hot-solid",
        category_id: 123,
        type_of_icon: "SOLID",
        term: ["fire"]
    },
    {
        name: "hourglass",
        slug: "hourglass-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "image",
        slug: "image-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "inbox",
        slug: "inbox-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "info-circle",
        slug: "info-circle-solid",
        category_id: 94,
        type_of_icon: "SOLID"
    },
    {
        name: "joystick-alt",
        slug: "joystick-alt-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "joystick",
        slug: "joystick-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "layer",
        slug: "layer-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "left-arrow-circle",
        slug: "left-arrow-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "like",
        slug: "like-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "lock-open",
        slug: "lock-open-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "lock",
        slug: "lock-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "map-alt",
        slug: "map-alt-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "map",
        slug: "map-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "message-rounded",
        slug: "message-rounded-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message",
        slug: "message-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "microphone-off",
        slug: "microphone-off-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "microphone",
        slug: "microphone-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "minus-circle",
        slug: "minus-circle-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "moon",
        slug: "moon-solid",
        category_id: 123,
        type_of_icon: "SOLID"
    },
    {
        name: "mouse",
        slug: "mouse-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "music",
        slug: "music-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "navigation",
        slug: "navigation-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "news",
        slug: "news-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "package",
        slug: "package-solid",
        category_id: 104,
        type_of_icon: "SOLID",
        term: ["box", "shipping", "delivery"]
    },
    {
        name: "paper-plane",
        slug: "paper-plane-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "paste",
        slug: "paste-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "pen",
        slug: "pen-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "pencil",
        slug: "pencil-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "phone-call",
        slug: "phone-call-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "phone-incoming",
        slug: "phone-incoming-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "phone-outgoing",
        slug: "phone-outgoing-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "phone",
        slug: "phone-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "pie-chart-alt",
        slug: "pie-chart-alt-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "pie-chart",
        slug: "pie-chart-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "pin",
        slug: "pin-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "playlist",
        slug: "playlist-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "plug",
        slug: "plug-solid",
        category_id: 116,
        type_of_icon: "SOLID",
        term: ["charging"]
    },
    {
        name: "plus-circle",
        slug: "plus-circle-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "printer",
        slug: "printer-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "purchase-tag",
        slug: "purchase-tag-solid",
        category_id: 104,
        type_of_icon: "SOLID",
        term: ["price", "cost"]
    },
    {
        name: "quote-left",
        slug: "quote-left-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "quote-right",
        slug: "quote-right-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "radio",
        slug: "radio-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "rename",
        slug: "rename-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "report",
        slug: "report-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "right-arrow-circle",
        slug: "right-arrow-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "ruler",
        slug: "ruler-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "save",
        slug: "save-solid",
        category_id: 116,
        type_of_icon: "SOLID",
        term: ["floppy disk"]
    },
    {
        name: "sort-alt",
        slug: "sort-alt-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "select-multiple",
        slug: "select-multiple-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "send",
        slug: "send-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "server",
        slug: "server-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "share-alt",
        slug: "share-alt-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "share",
        slug: "share-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "shield",
        slug: "shield-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "shopping-bag-alt",
        slug: "shopping-bag-alt-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "shopping-bag",
        slug: "shopping-bag-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "show",
        slug: "show-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "happy",
        slug: "happy-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "meh",
        slug: "meh-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "sad",
        slug: "sad-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "spreadsheet",
        slug: "spreadsheet-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "star",
        slug: "star-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "store",
        slug: "store-solid",
        category_id: 104,
        type_of_icon: "SOLID",
        term: ["shop", "market"]
    },
    {
        name: "sun",
        slug: "sun-solid",
        category_id: 123,
        type_of_icon: "SOLID"
    },
    {
        name: "t-shirt",
        slug: "t-shirt-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "tag-x",
        slug: "tag-x-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "tag",
        slug: "tag-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "tennis-ball",
        slug: "tennis-ball-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["deuce"]
    },
    {
        name: "terminal",
        slug: "terminal-solid",
        category_id: 100,
        type_of_icon: "SOLID",
        term: ["command line"]
    },
    {
        name: "to-top",
        slug: "to-top-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "toggle-left",
        slug: "toggle-left-solid",
        category_id: 110,
        type_of_icon: "SOLID",
        term: ["switch"]
    },
    {
        name: "toggle-right",
        slug: "toggle-right-solid",
        category_id: 110,
        type_of_icon: "SOLID",
        term: ["switch"]
    },
    {
        name: "torch",
        slug: "torch-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "trash-alt",
        slug: "trash-alt-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "trash",
        slug: "trash-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "trophy",
        slug: "trophy-solid",
        category_id: 119,
        type_of_icon: "SOLID"
    },
    {
        name: "truck",
        slug: "truck-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "up-arrow-circle",
        slug: "up-arrow-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "upvote",
        slug: "upvote-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "user-circle",
        slug: "user-circle-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "user-detail",
        slug: "user-detail-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "user-minus",
        slug: "user-minus-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "user-plus",
        slug: "user-plus-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "user",
        slug: "user-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "video-off",
        slug: "video-off-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "video",
        slug: "video-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "videos",
        slug: "videos-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "volume-full",
        slug: "volume-full-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "volume-low",
        slug: "volume-low-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "volume-mute",
        slug: "volume-mute-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "volume",
        slug: "volume-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "wallet",
        slug: "wallet-solid",
        category_id: 107,
        type_of_icon: "SOLID",
        term: ["money"]
    },
    {
        name: "watch-alt",
        slug: "watch-alt-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "watch",
        slug: "watch-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "widget",
        slug: "widget-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "wrench",
        slug: "wrench-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "x-circle",
        slug: "x-circle-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "zap",
        slug: "zap-solid",
        category_id: 123,
        type_of_icon: "SOLID",
        term: ["bolt"]
    },
    {
        name: "folder-open",
        slug: "folder-open-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "battery-low",
        slug: "battery-low-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "conversation",
        slug: "conversation-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "discussion"]
    },
    {
        name: "dashboard",
        slug: "dashboard-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "file-plus",
        slug: "file-plus-solid",
        category_id: 106,
        type_of_icon: "SOLID",
        term: ["add", "file add", "new file"]
    },
    {
        name: "slider-alt",
        slug: "slider-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "google-plus",
        slug: "google-plus-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "google-plus-circle",
        slug: "google-plus-circle-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "linkedin-square",
        slug: "linkedin-square-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "medium",
        slug: "medium-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "medium-square",
        slug: "medium-square-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "skype",
        slug: "skype-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "slack-old",
        slug: "slack-old-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "slack",
        slug: "slack-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "twitch",
        slug: "twitch-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "discord",
        slug: "discord-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "reddit",
        slug: "reddit-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["social media"]
    },
    {
        name: "pinterest",
        slug: "pinterest-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "blogger",
        slug: "blogger-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "certification",
        slug: "certification-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "certification",
        slug: "certification-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "rocket",
        slug: "rocket-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "rocket",
        slug: "rocket-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "check-circle",
        slug: "check-circle-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "check-circle",
        slug: "check-circle-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "checkbox",
        slug: "checkbox-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "checkbox-checked",
        slug: "checkbox-checked-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "star-half",
        slug: "star-half-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "bus",
        slug: "bus-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "bus",
        slug: "bus-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "check-double",
        slug: "check-double-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "dumbbell",
        slug: "dumbbell-regular",
        category_id: 109,
        type_of_icon: "REGULAR",
        term: ["gym", "workout"]
    },
    {
        name: "bot",
        slug: "bot-regular",
        category_id: 105,
        type_of_icon: "REGULAR"
    },
    {
        name: "area",
        slug: "area-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "bot",
        slug: "bot-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "area",
        slug: "area-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "bed",
        slug: "bed-regular",
        category_id: 109,
        type_of_icon: "REGULAR",
        term: ["sleep"]
    },
    {
        name: "bed",
        slug: "bed-solid",
        category_id: 109,
        type_of_icon: "SOLID",
        term: ["sleep"]
    },
    {
        name: "bath",
        slug: "bath-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "bath",
        slug: "bath-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "train",
        slug: "train-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "train",
        slug: "train-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "taxi",
        slug: "taxi-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "taxi",
        slug: "taxi-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "movie",
        slug: "movie-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "movie",
        slug: "movie-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "hotel",
        slug: "hotel-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "planet",
        slug: "planet-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "planet",
        slug: "planet-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "list-ol",
        slug: "list-ol-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "video-plus",
        slug: "video-plus-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "video-plus",
        slug: "video-plus-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "menu-alt-left",
        slug: "menu-alt-left-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "menu-alt-right",
        slug: "menu-alt-right-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "box",
        slug: "box-regular",
        category_id: 106,
        type_of_icon: "REGULAR",
        term: ["archive"]
    },
    {
        name: "box",
        slug: "box-solid",
        category_id: 106,
        type_of_icon: "SOLID",
        term: ["archive"]
    },
    {
        name: "key",
        slug: "key-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "restaurant",
        slug: "restaurant-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "swim",
        slug: "swim-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "water",
        slug: "water-regular",
        category_id: 123,
        type_of_icon: "REGULAR"
    },
    {
        name: "wind",
        slug: "wind-regular",
        category_id: 123,
        type_of_icon: "REGULAR",
        term: ["breeze", "gust", "air"]
    },
    {
        name: "dialpad",
        slug: "dialpad-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["keypad"]
    },
    {
        name: "handicap",
        slug: "handicap-regular",
        category_id: 94,
        type_of_icon: "REGULAR",
        term: ["wheelchair", "injury"]
    },
    {
        name: "font-size",
        slug: "font-size-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "code-block",
        slug: "code-block-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "photo-album",
        slug: "photo-album-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "photo-album",
        slug: "photo-album-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "bell-ring",
        slug: "bell-ring-solid",
        category_id: 95,
        type_of_icon: "SOLID",
        term: ["alert", "notification"]
    },
    {
        name: "apple",
        slug: "apple-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "android",
        slug: "android-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "play-store",
        slug: "play-store-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "windows",
        slug: "windows-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["browser"]
    },
    {
        name: "vk",
        slug: "vk-logo",
        category_id: 97,
        type_of_icon: "LOGO",
        term: ["social media"]
    },
    {
        name: "pocket",
        slug: "pocket-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "strikethrough",
        slug: "strikethrough-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "file-blank",
        slug: "file-blank-regular",
        category_id: 106,
        type_of_icon: "REGULAR"
    },
    {
        name: "file-blank",
        slug: "file-blank-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "highlight",
        slug: "highlight-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "font-color",
        slug: "font-color-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "fingerprint",
        slug: "fingerprint-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "transfer",
        slug: "transfer-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "circle",
        slug: "circle-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "edit",
        slug: "edit-solid",
        category_id: 124,
        type_of_icon: "SOLID",
        term: ["writing", "note", "pencil"]
    },
    {
        name: "ball",
        slug: "ball-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["football", "rugby"]
    },
    {
        name: "ball",
        slug: "ball-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["football", "rugby"]
    },
    {
        name: "football",
        slug: "football-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["soccer", "goal"]
    },
    {
        name: "film",
        slug: "film-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "dollar-circle",
        slug: "dollar-circle-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "dollar-circle",
        slug: "dollar-circle-solid",
        category_id: 107,
        type_of_icon: "SOLID"
    },
    {
        name: "skull",
        slug: "skull-solid",
        category_id: 105,
        type_of_icon: "SOLID"
    },
    {
        name: "messenger",
        slug: "messenger-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "search-alt",
        slug: "search-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR",
        term: ["magnifying glass"]
    },
    {
        name: "image-alt",
        slug: "image-alt-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "microphone-alt",
        slug: "microphone-alt-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "analyse",
        slug: "analyse-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "x-square",
        slug: "x-square-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "plus-square",
        slug: "plus-square-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "minus-square",
        slug: "minus-square-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "disc",
        slug: "disc-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "disc",
        slug: "disc-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "equalizer",
        slug: "equalizer-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "stats",
        slug: "stats-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "move-horizontal",
        slug: "move-horizontal-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "move-vertical",
        slug: "move-vertical-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "flame",
        slug: "flame-solid",
        category_id: 123,
        type_of_icon: "SOLID"
    },
    {
        name: "grid-horizontal",
        slug: "grid-horizontal-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "grid-vertical",
        slug: "grid-vertical-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "grid-small",
        slug: "grid-small-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "badge",
        slug: "badge-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "badge",
        slug: "badge-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "id-card",
        slug: "id-card-regular",
        category_id: 122,
        type_of_icon: "REGULAR"
    },
    {
        name: "sort-up",
        slug: "sort-up-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "sort-down",
        slug: "sort-down-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "note",
        slug: "note-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "note",
        slug: "note-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "test-tube",
        slug: "test-tube-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "help-circle",
        slug: "help-circle-regular",
        category_id: 94,
        type_of_icon: "REGULAR"
    },
    {
        name: "help-circle",
        slug: "help-circle-solid",
        category_id: 94,
        type_of_icon: "SOLID"
    },
    {
        name: "card",
        slug: "card-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "card",
        slug: "card-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "rewind-circle",
        slug: "rewind-circle-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "magnet",
        slug: "magnet-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "magnet",
        slug: "magnet-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "500px",
        slug: "500px-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "angular",
        slug: "angular-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "codepen",
        slug: "codepen-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "creative-commons",
        slug: "creative-commons-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "digitalocean",
        slug: "digitalocean-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "deviantart",
        slug: "deviantart-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "discourse",
        slug: "discourse-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "dropbox",
        slug: "dropbox-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "drupal",
        slug: "drupal-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "ebay",
        slug: "ebay-logo",
        category_id: 104,
        type_of_icon: "LOGO"
    },
    {
        name: "amazon",
        slug: "amazon-logo",
        category_id: 104,
        type_of_icon: "LOGO"
    },
    {
        name: "digg",
        slug: "digg-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "unsplash",
        slug: "unsplash-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "wikipedia",
        slug: "wikipedia-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "sass",
        slug: "sass-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "foursquare",
        slug: "foursquare-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "invision",
        slug: "invision-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "opera",
        slug: "opera-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "airbnb",
        slug: "airbnb-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "yelp",
        slug: "yelp-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "quora",
        slug: "quora-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "git",
        slug: "git-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "html5",
        slug: "html5-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "product-hunt",
        slug: "product-hunt-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "magento",
        slug: "magento-logo",
        category_id: 104,
        type_of_icon: "LOGO"
    },
    {
        name: "stack-overflow",
        slug: "stack-overflow-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "firefox",
        slug: "firefox-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "javascript",
        slug: "javascript-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "nodejs",
        slug: "nodejs-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "kickstarter",
        slug: "kickstarter-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "vuejs",
        slug: "vuejs-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "bing",
        slug: "bing-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "react",
        slug: "react-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "periscope",
        slug: "periscope-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "wordpress",
        slug: "wordpress-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "telegram",
        slug: "telegram-logo",
        category_id: 101,
        type_of_icon: "LOGO"
    },
    {
        name: "stripe",
        slug: "stripe-logo",
        category_id: 107,
        type_of_icon: "LOGO"
    },
    {
        name: "edge",
        slug: "edge-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "paypal",
        slug: "paypal-logo",
        category_id: 107,
        type_of_icon: "LOGO"
    },
    {
        name: "internet-explorer",
        slug: "internet-explorer-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "joomla",
        slug: "joomla-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "dailymotion",
        slug: "dailymotion-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "chrome",
        slug: "chrome-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "baidu",
        slug: "baidu-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "visa",
        slug: "visa-logo",
        category_id: 107,
        type_of_icon: "LOGO"
    },
    {
        name: "mastercard",
        slug: "mastercard-logo",
        category_id: 107,
        type_of_icon: "LOGO"
    },
    {
        name: "redux",
        slug: "redux-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "bootstrap",
        slug: "bootstrap-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "yahoo",
        slug: "yahoo-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "microsoft",
        slug: "microsoft-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "css3",
        slug: "css3-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "jsfiddle",
        slug: "jsfiddle-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "shopify",
        slug: "shopify-logo",
        category_id: 104,
        type_of_icon: "LOGO"
    },
    {
        name: "flickr",
        slug: "flickr-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "less",
        slug: "less-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "snapchat",
        slug: "snapchat-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "soundcloud",
        slug: "soundcloud-logo",
        category_id: 114,
        type_of_icon: "LOGO"
    },
    {
        name: "spotify",
        slug: "spotify-logo",
        category_id: 114,
        type_of_icon: "LOGO"
    },
    {
        name: "trello",
        slug: "trello-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "wix",
        slug: "wix-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "mailchimp",
        slug: "mailchimp-logo",
        category_id: 101,
        type_of_icon: "LOGO"
    },
    {
        name: "medium-old",
        slug: "medium-old-logo",
        category_id: 124,
        type_of_icon: "LOGO"
    },
    {
        name: "squarespace",
        slug: "squarespace-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "whatsapp-square",
        slug: "whatsapp-square-logo",
        category_id: 101,
        type_of_icon: "LOGO"
    },
    {
        name: "flickr-square",
        slug: "flickr-square-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "ambulance",
        slug: "ambulance-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "left-arrow-square",
        slug: "left-arrow-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "up-arrow-square",
        slug: "up-arrow-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "down-arrow-square",
        slug: "down-arrow-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "right-arrow-square",
        slug: "right-arrow-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "user-badge",
        slug: "user-badge-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-event",
        slug: "calendar-event-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-left",
        slug: "caret-left-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-up",
        slug: "caret-up-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-right",
        slug: "caret-right-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-down",
        slug: "caret-down-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "gas-pump",
        slug: "gas-pump-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "landmark",
        slug: "landmark-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "show-alt",
        slug: "show-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "badge-check",
        slug: "badge-check-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "badge-check",
        slug: "badge-check-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "rotate-left",
        slug: "rotate-left-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "coffee-alt",
        slug: "coffee-alt-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "brush",
        slug: "brush-regular",
        category_id: 102,
        type_of_icon: "REGULAR",
        term: ["color", "colour", "painting"]
    },
    {
        name: "brush",
        slug: "brush-solid",
        category_id: 102,
        type_of_icon: "SOLID",
        term: ["color", "colour", "painting"]
    },
    {
        name: "keyboard",
        slug: "keyboard-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "megaphone",
        slug: "megaphone-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "directions",
        slug: "directions-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "direction-right",
        slug: "direction-right-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "unlink",
        slug: "unlink-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "paint",
        slug: "paint-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "joystick-button",
        slug: "joystick-button-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "joystick-button",
        slug: "joystick-button-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "font-family",
        slug: "font-family-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "flask",
        slug: "flask-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "capsule",
        slug: "capsule-solid",
        category_id: 109,
        type_of_icon: "SOLID",
        term: ["medicine"]
    },
    {
        name: "color-fill",
        slug: "color-fill-solid",
        category_id: 102,
        type_of_icon: "SOLID"
    },
    {
        name: "hotel",
        slug: "hotel-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "magic-wand",
        slug: "magic-wand-solid",
        category_id: 102,
        type_of_icon: "SOLID"
    },
    {
        name: "repeat",
        slug: "repeat-regular",
        category_id: 114,
        type_of_icon: "REGULAR"
    },
    {
        name: "eraser",
        slug: "eraser-solid",
        category_id: 102,
        type_of_icon: "SOLID",
        term: ["rubber"]
    },
    {
        name: "cloud-rain",
        slug: "cloud-rain-solid",
        category_id: 123,
        type_of_icon: "SOLID"
    },
    {
        name: "cloud-lightning",
        slug: "cloud-lightning-solid",
        category_id: 123,
        type_of_icon: "SOLID"
    },
    {
        name: "eyedropper",
        slug: "eyedropper-solid",
        category_id: 102,
        type_of_icon: "SOLID"
    },
    {
        name: "user-rectangle",
        slug: "user-rectangle-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "plane",
        slug: "plane-solid",
        category_id: 121,
        type_of_icon: "SOLID",
        term: ["flight", "fly"]
    },
    {
        name: "tree",
        slug: "tree-solid",
        category_id: 121,
        type_of_icon: "SOLID",
        term: ["forest", "christmas"]
    },
    {
        name: "factory",
        slug: "factory-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "ship",
        slug: "ship-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "walk",
        slug: "walk-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "yin-yang",
        slug: "yin-yang-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "file-pdf",
        slug: "file-pdf-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "money",
        slug: "money-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "home-circle",
        slug: "home-circle-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "home-circle",
        slug: "home-circle-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "location-plus",
        slug: "location-plus-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "location-plus",
        slug: "location-plus-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "arch",
        slug: "arch-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "arch",
        slug: "arch-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "atom",
        slug: "atom-regular",
        category_id: 113,
        type_of_icon: "REGULAR"
    },
    {
        name: "badge-dollar",
        slug: "badge-dollar-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "baseball",
        slug: "baseball-regular",
        category_id: 119,
        type_of_icon: "REGULAR"
    },
    {
        name: "beer",
        slug: "beer-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "beer",
        slug: "beer-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "bible",
        slug: "bible-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "bible",
        slug: "bible-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "bomb",
        slug: "bomb-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "bomb",
        slug: "bomb-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "bus-school",
        slug: "bus-school-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "bus-school",
        slug: "bus-school-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "cabinet",
        slug: "cabinet-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "cabinet",
        slug: "cabinet-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-edit",
        slug: "calendar-edit-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-edit",
        slug: "calendar-edit-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "car-wash",
        slug: "car-wash-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "car-garage",
        slug: "car-garage-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "car-mechanic",
        slug: "car-mechanic-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "car-crash",
        slug: "car-crash-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "coffee-togo",
        slug: "coffee-togo-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "coffee-togo",
        slug: "coffee-togo-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "chess",
        slug: "chess-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["strategy"]
    },
    {
        name: "dryer",
        slug: "dryer-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "washer",
        slug: "washer-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "pointer",
        slug: "pointer-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "pointer",
        slug: "pointer-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "microchip",
        slug: "microchip-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "microchip",
        slug: "microchip-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "piano",
        slug: "piano-solid",
        category_id: 103,
        type_of_icon: "SOLID"
    },
    {
        name: "file-export",
        slug: "file-export-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "file-import",
        slug: "file-import-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "flag-checkered",
        slug: "flag-checkered-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["f1", "racing"]
    },
    {
        name: "heart-circle",
        slug: "heart-circle-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "heart-circle",
        slug: "heart-circle-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "heart-square",
        slug: "heart-square-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "heart-square",
        slug: "heart-square-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "home-heart",
        slug: "home-heart-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "home-heart",
        slug: "home-heart-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "info-square",
        slug: "info-square-regular",
        category_id: 94,
        type_of_icon: "REGULAR"
    },
    {
        name: "info-square",
        slug: "info-square-solid",
        category_id: 94,
        type_of_icon: "SOLID"
    },
    {
        name: "layer-plus",
        slug: "layer-plus-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "layer-plus",
        slug: "layer-plus-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "layer-minus",
        slug: "layer-minus-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "layer-minus",
        slug: "layer-minus-solid",
        category_id: 111,
        type_of_icon: "SOLID"
    },
    {
        name: "recycle",
        slug: "recycle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "traffic-cone",
        slug: "traffic-cone-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "traffic-cone",
        slug: "traffic-cone-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "wifi-2",
        slug: "wifi-2-regular",
        category_id: 115,
        type_of_icon: "REGULAR"
    },
    {
        name: "wifi-1",
        slug: "wifi-1-regular",
        category_id: 115,
        type_of_icon: "REGULAR"
    },
    {
        name: "wifi-0",
        slug: "wifi-0-regular",
        category_id: 115,
        type_of_icon: "REGULAR"
    },
    {
        name: "mask",
        slug: "mask-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "mask",
        slug: "mask-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "low-vision",
        slug: "low-vision-regular",
        category_id: 94,
        type_of_icon: "REGULAR",
        term: ["eye", "view", "visibility"]
    },
    {
        name: "low-vision",
        slug: "low-vision-solid",
        category_id: 94,
        type_of_icon: "SOLID",
        term: ["eye", "view", "visibility"]
    },
    {
        name: "radiation",
        slug: "radiation-solid",
        category_id: 95,
        type_of_icon: "SOLID",
        term: ["hazard", "danger"]
    },
    {
        name: "been-here",
        slug: "been-here-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "been-here",
        slug: "been-here-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "current-location",
        slug: "current-location-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-from-top",
        slug: "arrow-from-top-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-from-top",
        slug: "arrow-from-top-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "arrow-from-bottom",
        slug: "arrow-from-bottom-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-from-bottom",
        slug: "arrow-from-bottom-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "arrow-from-left",
        slug: "arrow-from-left-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-from-left",
        slug: "arrow-from-left-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "arrow-from-right",
        slug: "arrow-from-right-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-from-right",
        slug: "arrow-from-right-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "arrow-to-right",
        slug: "arrow-to-right-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-to-right",
        slug: "arrow-to-right-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "arrow-to-left",
        slug: "arrow-to-left-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-to-left",
        slug: "arrow-to-left-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "arrow-to-top",
        slug: "arrow-to-top-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-to-top",
        slug: "arrow-to-top-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "arrow-to-bottom",
        slug: "arrow-to-bottom-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "arrow-to-bottom",
        slug: "arrow-to-bottom-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "book-reader",
        slug: "book-reader-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "book-reader",
        slug: "book-reader-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "edit-location",
        slug: "edit-location-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "ev-station",
        slug: "ev-station-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "shapes",
        slug: "shapes-solid",
        category_id: 118,
        type_of_icon: "SOLID"
    },
    {
        name: "florist",
        slug: "florist-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "pizza",
        slug: "pizza-solid",
        category_id: 108,
        type_of_icon: "SOLID"
    },
    {
        name: "scan",
        slug: "scan-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-week",
        slug: "calendar-week-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-week",
        slug: "calendar-week-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "glasses",
        slug: "glasses-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "glasses-alt",
        slug: "glasses-alt-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "border-none",
        slug: "border-none-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "border-inner",
        slug: "border-inner-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "dice-1",
        slug: "dice-1-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["game", "random"]
    },
    {
        name: "dice-1",
        slug: "dice-1-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["game", "random"]
    },
    {
        name: "dice-2",
        slug: "dice-2-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["game", "random"]
    },
    {
        name: "dice-2",
        slug: "dice-2-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["game", "random"]
    },
    {
        name: "dice-3",
        slug: "dice-3-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["game", "random"]
    },
    {
        name: "dice-3",
        slug: "dice-3-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["game", "random"]
    },
    {
        name: "dice-4",
        slug: "dice-4-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["game", "random"]
    },
    {
        name: "dice-4",
        slug: "dice-4-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["game", "random"]
    },
    {
        name: "dice-5",
        slug: "dice-5-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["game", "random"]
    },
    {
        name: "dice-5",
        slug: "dice-5-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["game", "random"]
    },
    {
        name: "dice-6",
        slug: "dice-6-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["game", "random"]
    },
    {
        name: "dice-6",
        slug: "dice-6-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["game", "random"]
    },
    {
        name: "webcam",
        slug: "webcam-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "webcam",
        slug: "webcam-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "spray-can",
        slug: "spray-can-regular",
        category_id: 102,
        type_of_icon: "REGULAR",
        term: ["color", "colour", "paint spray"]
    },
    {
        name: "spray-can",
        slug: "spray-can-solid",
        category_id: 102,
        type_of_icon: "SOLID",
        term: ["color", "colour", "paint spray"]
    },
    {
        name: "file-archive",
        slug: "file-archive-solid",
        category_id: 106,
        type_of_icon: "SOLID"
    },
    {
        name: "sticker",
        slug: "sticker-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "sticker",
        slug: "sticker-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "tachometer",
        slug: "tachometer-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "tachometer",
        slug: "tachometer-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "thermometer",
        slug: "thermometer-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "game",
        slug: "game-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["pacman"]
    },
    {
        name: "game",
        slug: "game-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["pacman"]
    },
    {
        name: "abacus",
        slug: "abacus-regular",
        category_id: 119,
        type_of_icon: "REGULAR"
    },
    {
        name: "alarm-snooze",
        slug: "alarm-snooze-regular",
        category_id: 120,
        type_of_icon: "REGULAR",
        term: ["alert", "zzz", "sleep"]
    },
    {
        name: "alarm-snooze",
        slug: "alarm-snooze-solid",
        category_id: 120,
        type_of_icon: "SOLID",
        term: ["alert", "zzz", "sleep"]
    },
    {
        name: "alarm-exclamation",
        slug: "alarm-exclamation-regular",
        category_id: 120,
        type_of_icon: "REGULAR",
        term: ["alert", "error"]
    },
    {
        name: "alarm-exclamation",
        slug: "alarm-exclamation-solid",
        category_id: 120,
        type_of_icon: "SOLID",
        term: ["alert", "error"]
    },
    {
        name: "chevrons-left",
        slug: "chevrons-left-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["arrow"]
    },
    {
        name: "chevrons-right",
        slug: "chevrons-right-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["arrow"]
    },
    {
        name: "chevrons-up",
        slug: "chevrons-up-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["arrow"]
    },
    {
        name: "chevrons-down",
        slug: "chevrons-down-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["arrow"]
    },
    {
        name: "chevron-down",
        slug: "chevron-down-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["arrow"]
    },
    {
        name: "chevron-up",
        slug: "chevron-up-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["arrow"]
    },
    {
        name: "chevron-right",
        slug: "chevron-right-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["arrow"]
    },
    {
        name: "chevron-left",
        slug: "chevron-left-solid",
        category_id: 96,
        type_of_icon: "SOLID",
        term: ["arrow"]
    },
    {
        name: "guitar-amp",
        slug: "guitar-amp-solid",
        category_id: 114,
        type_of_icon: "SOLID"
    },
    {
        name: "up-arrow-alt",
        slug: "up-arrow-alt-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "down-arrow-alt",
        slug: "down-arrow-alt-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "left-arrow-alt",
        slug: "left-arrow-alt-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "right-arrow-alt",
        slug: "right-arrow-alt-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "medal",
        slug: "medal-regular",
        category_id: 119,
        type_of_icon: "REGULAR",
        term: ["honor", "honour", "achievement"]
    },
    {
        name: "medal",
        slug: "medal-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["honor", "honour", "achievement"]
    },
    {
        name: "shopping-bags",
        slug: "shopping-bags-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "baseball",
        slug: "baseball-solid",
        category_id: 119,
        type_of_icon: "SOLID"
    },
    {
        name: "task-x",
        slug: "task-x-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "basketball",
        slug: "basketball-solid",
        category_id: 119,
        type_of_icon: "SOLID",
        term: ["nba"]
    },
    {
        name: "barcode-reader",
        slug: "barcode-reader-regular",
        category_id: 103,
        type_of_icon: "REGULAR"
    },
    {
        name: "blanket",
        slug: "blanket-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "blanket",
        slug: "blanket-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "binoculars",
        slug: "binoculars-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "bone",
        slug: "bone-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "bone",
        slug: "bone-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "bong",
        slug: "bong-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "bong",
        slug: "bong-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "book-alt",
        slug: "book-alt-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "book-alt",
        slug: "book-alt-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "book-heart",
        slug: "book-heart-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "book-heart",
        slug: "book-heart-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "book-add",
        slug: "book-add-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "book-add",
        slug: "book-add-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "bracket",
        slug: "bracket-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "brain",
        slug: "brain-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "brain",
        slug: "brain-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "border-outer",
        slug: "border-outer-regular",
        category_id: 111,
        type_of_icon: "REGULAR"
    },
    {
        name: "braille",
        slug: "braille-regular",
        category_id: 94,
        type_of_icon: "REGULAR"
    },
    {
        name: "window-alt",
        slug: "window-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR",
        term: ["browser"]
    },
    {
        name: "window-alt",
        slug: "window-alt-solid",
        category_id: 110,
        type_of_icon: "SOLID",
        term: ["browser"]
    },
    {
        name: "calendar-heart",
        slug: "calendar-heart-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-heart",
        slug: "calendar-heart-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "wine",
        slug: "wine-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "vial",
        slug: "vial-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "color-fill",
        slug: "color-fill-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "capsule",
        slug: "capsule-regular",
        category_id: 109,
        type_of_icon: "REGULAR",
        term: ["medicine"]
    },
    {
        name: "eraser",
        slug: "eraser-regular",
        category_id: 102,
        type_of_icon: "REGULAR",
        term: ["rubber"]
    },
    {
        name: "drink",
        slug: "drink-regular",
        category_id: 108,
        type_of_icon: "REGULAR"
    },
    {
        name: "cctv",
        slug: "cctv-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "cctv",
        slug: "cctv-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "chair",
        slug: "chair-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "network-chart",
        slug: "network-chart-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "network-chart",
        slug: "network-chart-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "vector",
        slug: "vector-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "vector",
        slug: "vector-solid",
        category_id: 102,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-exclamation",
        slug: "calendar-exclamation-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-exclamation",
        slug: "calendar-exclamation-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "calendar-star",
        slug: "calendar-star-regular",
        category_id: 120,
        type_of_icon: "REGULAR"
    },
    {
        name: "calendar-star",
        slug: "calendar-star-solid",
        category_id: 120,
        type_of_icon: "SOLID"
    },
    {
        name: "camera-home",
        slug: "camera-home-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "camera-home",
        slug: "camera-home-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "camera-movie",
        slug: "camera-movie-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "camera-movie",
        slug: "camera-movie-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "backpack",
        slug: "backpack-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "cart-download",
        slug: "cart-download-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "cart-add",
        slug: "cart-add-solid",
        category_id: 104,
        type_of_icon: "SOLID"
    },
    {
        name: "car-battery",
        slug: "car-battery-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "caret-right-circle",
        slug: "caret-right-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-left-circle",
        slug: "caret-left-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-up-circle",
        slug: "caret-up-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-down-circle",
        slug: "caret-down-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-right-square",
        slug: "caret-right-square-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-right-square",
        slug: "caret-right-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "caret-up-square",
        slug: "caret-up-square-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-up-square",
        slug: "caret-up-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "caret-left-square",
        slug: "caret-left-square-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-left-square",
        slug: "caret-left-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "caret-down-square",
        slug: "caret-down-square-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "caret-down-square",
        slug: "caret-down-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "shield-x",
        slug: "shield-x-regular",
        category_id: 100,
        type_of_icon: "REGULAR"
    },
    {
        name: "shield-x",
        slug: "shield-x-solid",
        category_id: 100,
        type_of_icon: "SOLID"
    },
    {
        name: "line-chart-down",
        slug: "line-chart-down-regular",
        category_id: 99,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-down-circle",
        slug: "chevron-down-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-down-circle",
        slug: "chevron-down-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "chevron-up-circle",
        slug: "chevron-up-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-up-circle",
        slug: "chevron-up-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "chevron-left-circle",
        slug: "chevron-left-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-left-circle",
        slug: "chevron-left-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "chevron-right-circle",
        slug: "chevron-right-circle-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-right-circle",
        slug: "chevron-right-circle-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "chevron-down-square",
        slug: "chevron-down-square-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-down-square",
        slug: "chevron-down-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "chevron-up-square",
        slug: "chevron-up-square-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-up-square",
        slug: "chevron-up-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "chevron-left-square",
        slug: "chevron-left-square-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-left-square",
        slug: "chevron-left-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "chevron-right-square",
        slug: "chevron-right-square-regular",
        category_id: 96,
        type_of_icon: "REGULAR"
    },
    {
        name: "chevron-right-square",
        slug: "chevron-right-square-solid",
        category_id: 96,
        type_of_icon: "SOLID"
    },
    {
        name: "church",
        slug: "church-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "church",
        slug: "church-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "coin",
        slug: "coin-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "coin",
        slug: "coin-solid",
        category_id: 107,
        type_of_icon: "SOLID"
    },
    {
        name: "coin-stack",
        slug: "coin-stack-regular",
        category_id: 107,
        type_of_icon: "REGULAR"
    },
    {
        name: "coin-stack",
        slug: "coin-stack-solid",
        category_id: 107,
        type_of_icon: "SOLID"
    },
    {
        name: "unite",
        slug: "unite-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "minus-front",
        slug: "minus-front-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "intersect",
        slug: "intersect-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "exclude",
        slug: "exclude-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "minus-back",
        slug: "minus-back-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "merge",
        slug: "merge-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "trim",
        slug: "trim-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "outline",
        slug: "outline-regular",
        category_id: 102,
        type_of_icon: "REGULAR"
    },
    {
        name: "bullseye",
        slug: "bullseye-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "meteor",
        slug: "meteor-regular",
        category_id: 116,
        type_of_icon: "REGULAR"
    },
    {
        name: "meteor",
        slug: "meteor-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "refresh",
        slug: "refresh-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "home-smile",
        slug: "home-smile-regular",
        category_id: 98,
        type_of_icon: "REGULAR"
    },
    {
        name: "home-smile",
        slug: "home-smile-solid",
        category_id: 98,
        type_of_icon: "SOLID"
    },
    {
        name: "envelope-open",
        slug: "envelope-open-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "envelope-open",
        slug: "envelope-open-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "dev-to",
        slug: "dev-to-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "message-alt-add",
        slug: "message-alt-add-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "new", "plus"]
    },
    {
        name: "message-alt-add",
        slug: "message-alt-add-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "new", "plus"]
    },
    {
        name: "message-alt-check",
        slug: "message-alt-check-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-alt-check",
        slug: "message-alt-check-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-alt-error",
        slug: "message-alt-error-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-alt-error",
        slug: "message-alt-error-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-alt-x",
        slug: "message-alt-x-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-alt-x",
        slug: "message-alt-x-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-alt-minus",
        slug: "message-alt-minus-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-alt-minus",
        slug: "message-alt-minus-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-alt-edit",
        slug: "message-alt-edit-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-alt-edit",
        slug: "message-alt-edit-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-alt-detail",
        slug: "message-alt-detail-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-alt-detail",
        slug: "message-alt-detail-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-rounded-check",
        slug: "message-rounded-check-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-rounded-check",
        slug: "message-rounded-check-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-rounded-error",
        slug: "message-rounded-error-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-rounded-error",
        slug: "message-rounded-error-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-rounded-x",
        slug: "message-rounded-x-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-rounded-x",
        slug: "message-rounded-x-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-rounded-minus",
        slug: "message-rounded-minus-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-rounded-minus",
        slug: "message-rounded-minus-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-rounded-edit",
        slug: "message-rounded-edit-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-rounded-edit",
        slug: "message-rounded-edit-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-rounded-add",
        slug: "message-rounded-add-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "new", "plus"]
    },
    {
        name: "message-rounded-add",
        slug: "message-rounded-add-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "new", "plus"]
    },
    {
        name: "message-rounded-detail",
        slug: "message-rounded-detail-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-rounded-detail",
        slug: "message-rounded-detail-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-check",
        slug: "message-check-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-check",
        slug: "message-check-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-error",
        slug: "message-error-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-error",
        slug: "message-error-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-x",
        slug: "message-x-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-x",
        slug: "message-x-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-minus",
        slug: "message-minus-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-minus",
        slug: "message-minus-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-edit",
        slug: "message-edit-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-edit",
        slug: "message-edit-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-add",
        slug: "message-add-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "new", "plus"]
    },
    {
        name: "message-add",
        slug: "message-add-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "new", "plus"]
    },
    {
        name: "message-detail",
        slug: "message-detail-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-detail",
        slug: "message-detail-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-square-check",
        slug: "message-square-check-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-square-check",
        slug: "message-square-check-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-square-error",
        slug: "message-square-error-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-square-error",
        slug: "message-square-error-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-square-x",
        slug: "message-square-x-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-square-x",
        slug: "message-square-x-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-square-minus",
        slug: "message-square-minus-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-square-minus",
        slug: "message-square-minus-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "remove", "delete"]
    },
    {
        name: "message-square-edit",
        slug: "message-square-edit-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-square-edit",
        slug: "message-square-edit-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "message-square-add",
        slug: "message-square-add-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "comment", "new", "plus"]
    },
    {
        name: "message-square-add",
        slug: "message-square-add-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "comment", "new", "plus"]
    },
    {
        name: "message-square-detail",
        slug: "message-square-detail-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "message-square-detail",
        slug: "message-square-detail-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "comment-check",
        slug: "comment-check-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "comment-check",
        slug: "comment-check-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "comment-error",
        slug: "comment-error-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "comment-x",
        slug: "comment-x-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "message", "remove", "delete"]
    },
    {
        name: "comment-x",
        slug: "comment-x-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "message", "remove", "delete"]
    },
    {
        name: "comment-edit",
        slug: "comment-edit-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "comment-edit",
        slug: "comment-edit-solid",
        category_id: 101,
        type_of_icon: "SOLID"
    },
    {
        name: "comment-minus",
        slug: "comment-minus-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "message", "remove", "delete"]
    },
    {
        name: "comment-minus",
        slug: "comment-minus-solid",
        category_id: 101,
        type_of_icon: "SOLID",
        term: ["chat", "message", "remove", "delete"]
    },
    {
        name: "comment-add",
        slug: "comment-add-regular",
        category_id: 101,
        type_of_icon: "REGULAR",
        term: ["chat", "message", "new", "plus"]
    },
    {
        name: "comment-detail",
        slug: "comment-detail-regular",
        category_id: 101,
        type_of_icon: "REGULAR"
    },
    {
        name: "cookie",
        slug: "cookie-regular",
        category_id: 108,
        type_of_icon: "REGULAR",
        term: ["biscuit"]
    },
    {
        name: "cookie",
        slug: "cookie-solid",
        category_id: 108,
        type_of_icon: "SOLID",
        term: ["biscuit"]
    },
    {
        name: "copyright",
        slug: "copyright-solid",
        category_id: 99,
        type_of_icon: "SOLID"
    },
    {
        name: "credit-card-front",
        slug: "credit-card-front-regular",
        category_id: 107,
        type_of_icon: "REGULAR",
        term: ["finance", "money", "debit"]
    },
    {
        name: "credit-card-front",
        slug: "credit-card-front-solid",
        category_id: 107,
        type_of_icon: "SOLID",
        term: ["finance", "money", "debit"]
    },
    {
        name: "crop",
        slug: "crop-solid",
        category_id: 102,
        type_of_icon: "SOLID"
    },
    {
        name: "diamond",
        slug: "diamond-solid",
        category_id: 116,
        type_of_icon: "SOLID"
    },
    {
        name: "door-open",
        slug: "door-open-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "door-open",
        slug: "door-open-solid",
        category_id: 121,
        type_of_icon: "SOLID"
    },
    {
        name: "donate-heart",
        slug: "donate-heart-regular",
        category_id: 107,
        type_of_icon: "REGULAR",
        term: ["donation", "contribution"]
    },
    {
        name: "donate-heart",
        slug: "donate-heart-solid",
        category_id: 107,
        type_of_icon: "SOLID",
        term: ["donation", "contribution"]
    },
    {
        name: "donate-blood",
        slug: "donate-blood-regular",
        category_id: 109,
        type_of_icon: "REGULAR"
    },
    {
        name: "donate-blood",
        slug: "donate-blood-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "shape-polygon",
        slug: "shape-polygon-regular",
        category_id: 118,
        type_of_icon: "REGULAR"
    },
    {
        name: "zoom",
        slug: "zoom-logo",
        category_id: 117,
        type_of_icon: "LOGO"
    },
    {
        name: "microsoft-teams",
        slug: "microsoft-teams-logo",
        category_id: 99,
        type_of_icon: "LOGO"
    },
    {
        name: "blender",
        slug: "blender-logo",
        category_id: 102,
        type_of_icon: "LOGO"
    },
    {
        name: "kubernetes",
        slug: "kubernetes-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "google-cloud",
        slug: "google-cloud-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "django",
        slug: "django-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "spring-boot",
        slug: "spring-boot-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "tux",
        slug: "tux-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "markdown",
        slug: "markdown-logo",
        category_id: 124,
        type_of_icon: "LOGO"
    },
    {
        name: "python",
        slug: "python-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "ok-ru",
        slug: "ok-ru-logo",
        category_id: 97,
        type_of_icon: "LOGO"
    },
    {
        name: "firebase",
        slug: "firebase-logo",
        category_id: 100,
        type_of_icon: "LOGO"
    },
    {
        name: "c-plus-plus",
        slug: "c-plus-plus-logo",
        category_id: 100,
        type_of_icon: "LOGO",
        term: ["c++"]
    },
    {
        name: "bookmark-heart",
        slug: "bookmark-heart-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "bookmark-heart",
        slug: "bookmark-heart-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "sort-alt-2",
        slug: "sort-alt-2-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "category",
        slug: "category-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "category",
        slug: "category-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "category-alt",
        slug: "category-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "category-alt",
        slug: "category-alt-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "bookmark-alt",
        slug: "bookmark-alt-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "bookmark-alt",
        slug: "bookmark-alt-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "bookmark-alt-plus",
        slug: "bookmark-alt-plus-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "bookmark-alt-plus",
        slug: "bookmark-alt-plus-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "bookmark-alt-minus",
        slug: "bookmark-alt-minus-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "bookmark-alt-minus",
        slug: "bookmark-alt-minus-solid",
        category_id: 124,
        type_of_icon: "SOLID"
    },
    {
        name: "face-mask",
        slug: "face-mask-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    },
    {
        name: "tv",
        slug: "tv-solid",
        category_id: 116,
        type_of_icon: "SOLID",
        term: ["television", "monitor"]
    },
    {
        name: "tag-alt",
        slug: "tag-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "tag-alt",
        slug: "tag-alt-solid",
        category_id: 110,
        type_of_icon: "SOLID"
    },
    {
        name: "movie-play",
        slug: "movie-play-regular",
        category_id: 117,
        type_of_icon: "REGULAR"
    },
    {
        name: "movie-play",
        slug: "movie-play-solid",
        category_id: 117,
        type_of_icon: "SOLID"
    },
    {
        name: "user-account",
        slug: "user-account-solid",
        category_id: 122,
        type_of_icon: "SOLID"
    },
    {
        name: "expand-alt",
        slug: "expand-alt-regular",
        category_id: 110,
        type_of_icon: "REGULAR"
    },
    {
        name: "library",
        slug: "library-regular",
        category_id: 124,
        type_of_icon: "REGULAR"
    },
    {
        name: "trip",
        slug: "trip-regular",
        category_id: 121,
        type_of_icon: "REGULAR"
    },
    {
        name: "virus",
        slug: "virus-solid",
        category_id: 109,
        type_of_icon: "SOLID",
        term: ["disease", "covid", "corona"]
    },
    {
        name: "virus-block",
        slug: "virus-block-solid",
        category_id: 109,
        type_of_icon: "SOLID"
    }
];

function getIconClass(icon: Icon) {
    if (icon.type_of_icon === "LOGO") {
        return `bxl-${icon.name}`;
    } else if (icon.type_of_icon === "SOLID") {
        return `bxs-${icon.name}`;
    } else {
        return `bx-${icon.name}`;
    }
}

for (const icon of icons) {
    icon.className = getIconClass(icon);
}

export default {
    categories,
    icons
};
