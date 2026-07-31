"use strict";

/* =========================================
   GRUNDEINSTELLUNGEN
========================================= */

const playerCount = document.getElementById("playerCount");
const onlineCount = document.getElementById("onlineCount");
const gamemodeCount = document.getElementById("gamemodeCount");

const playerSearch = document.getElementById("playerSearch");
const playerEntries = document.querySelectorAll(".player-entry");
const noResults = document.getElementById("noResults");

const gamemodeButtons =
    document.querySelectorAll(".gamemode-chip");

const navLinks =
    document.querySelectorAll(".nav-link");

const mobileMenuButton =
    document.getElementById("mobileMenuButton");

const navCenter =
    document.getElementById("navCenter");

/* =========================================
   STARTWERTE
========================================= */

/*
   Players bleibt erstmal auf 0.
   Online bleibt ebenfalls auf 0.

   Eine echte Live-Online-Anzeige ist mit
   GitHub Pages alleine nicht möglich,
   weil GitHub Pages keinen Server und
   keine Datenbank besitzt.
*/

const websiteData = {
    players: 0,
    online: 0,
    gamemodes: 10
};

/* =========================================
   ZAHLEN ANZEIGEN
========================================= */

function animateNumber(element, targetNumber) {

    if (!element) {
        return;
    }

    const duration = 700;
    const startTime = performance.now();

    function updateNumber(currentTime) {

        const passedTime =
            currentTime - startTime;

        const progress =
            Math.min(passedTime / duration, 1);

        const currentNumber =
            Math.floor(targetNumber * progress);

        element.textContent =
            currentNumber.toLocaleString("de-DE");

        if (progress < 1) {
            requestAnimationFrame(updateNumber);
        }
    }

    requestAnimationFrame(updateNumber);
}

animateNumber(
    playerCount,
    websiteData.players
);

animateNumber(
    onlineCount,
    websiteData.online
);

animateNumber(
    gamemodeCount,
    websiteData.gamemodes
);

/* =========================================
   GAMEMODE BUTTONS
========================================= */

gamemodeButtons.forEach((button) => {

    button.addEventListener("click", () => {

        gamemodeButtons.forEach((modeButton) => {
            modeButton.classList.remove(
                "active-mode"
            );
        });

        button.classList.add(
            "active-mode"
        );
    });
});

/* =========================================
   SPIELERSUCHE
========================================= */

function searchPlayers() {

    if (!playerSearch) {
        return;
    }

    const searchValue =
        playerSearch.value
            .trim()
            .toLowerCase();

    let visiblePlayers = 0;

    playerEntries.forEach((entry) => {

        const playerName =
            entry.dataset.player
                ?.toLowerCase() || "";

        const playerFound =
            playerName.includes(searchValue);

        entry.classList.toggle(
            "hidden-player",
            !playerFound
        );

        entry.classList.toggle(
            "search-match",
            playerFound && searchValue !== ""
        );

        if (playerFound) {
            visiblePlayers++;
        }
    });

    if (noResults) {

        noResults.style.display =
            visiblePlayers === 0
                ? "block"
                : "none";
    }
}

if (playerSearch) {

    playerSearch.addEventListener(
        "input",
        searchPlayers
    );
}

/* =========================================
   NAVIGATION
========================================= */

navLinks.forEach((link) => {

    link.addEventListener("click", () => {

        navLinks.forEach((navLink) => {
            navLink.classList.remove("active");
        });

        link.classList.add("active");

        navCenter?.classList.remove(
            "menu-open"
        );
    });
});

/* =========================================
   MOBILES MENÜ
========================================= */

if (mobileMenuButton && navCenter) {

    mobileMenuButton.addEventListener(
        "click",
        () => {

            navCenter.classList.toggle(
                "menu-open"
            );

            const menuIsOpen =
                navCenter.classList.contains(
                    "menu-open"
                );

            mobileMenuButton.textContent =
                menuIsOpen ? "✕" : "☰";
        }
    );
}

/* =========================================
   PARTIKEL
========================================= */

function createParticles() {

    const particlesContainer =
        document.getElementById("particles");

    if (!particlesContainer) {
        return;
    }

    const particleAmount = 36;

    for (
        let particleIndex = 0;
        particleIndex < particleAmount;
        particleIndex++
    ) {

        const particle =
            document.createElement("span");

        particle.classList.add("particle");

        particle.style.left =
            `${Math.random() * 100}%`;

        particle.style.top =
            `${Math.random() * 100}%`;

        particle.style.opacity =
            `${0.15 + Math.random() * 0.65}`;

        particle.style.transform =
            `scale(${0.5 + Math.random() * 1.2})`;

        particle.style.setProperty(
            "--duration",
            `${3 + Math.random() * 6}s`
        );

        particle.style.animationDelay =
            `${Math.random() * 5}s`;

        particlesContainer.appendChild(
            particle
        );
    }
}

createParticles();

/* =========================================
   NAVBAR BEIM SCROLLEN
========================================= */

function updateActiveNavigation() {

    const sections =
        document.querySelectorAll(
            "main section[id]"
        );

    let activeSection = "home";

    sections.forEach((section) => {

        const sectionTop =
            section.offsetTop - 160;

        if (window.scrollY >= sectionTop) {
            activeSection = section.id;
        }
    });

    navLinks.forEach((link) => {

        const linkTarget =
            link.getAttribute("href")
                ?.replace("#", "");

        link.classList.toggle(
            "active",
            linkTarget === activeSection
        );
    });
}

window.addEventListener(
    "scroll",
    updateActiveNavigation
);

updateActiveNavigation();

/* =========================================
   KONSOLE
========================================= */

console.log(
    "MentalTiers wurde erfolgreich geladen!"
);
