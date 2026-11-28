// Ustawienia połączenia z Google. Te wartości nie są tajne – Google pozwala ich
// używać tylko ze stron wpisanych w konsoli (zbludzakowe-zabawy.github.io, localhost:8000).
window.KN_CONFIG = {
  // Identyfikator klienta OAuth (logowanie administratora)
  clientId: '834918363610-ud9t31t5hdnpnjcdc4om82cmj5r720ik.apps.googleusercontent.com',
  // Klucz API (tryb przeglądania bez logowania)
  apiKey: 'AIzaSyCPSiq9JD1hQdtl0rVqR9WTOvukz0BAiXE',
  // Plik z danymi aplikacji na Dysku administratora
  dataFileName: 'KamienickieNutki.json',
  // Jedyny folder na Dysku, w którym aplikacja zapisuje swoje pliki
  appFolderName: 'Kamienickie Nutki',
  // Katalog śpiewników dla chórzystów (id z linku „?chor=…” po publikacji). Dzięki temu zwykły adres
  // strony otwiera śpiewniki – także w aplikacji dodanej do ekranu iPhone'a.
  publicCatalogId: '17JcPVAK_vT7Vfjn8DHgAwolvUdkuuCSU',
};


// ===== WERSJA TESTOWA =====
// Ten fragment dokleja do js/config.js tylko publikacja wersji testowej (tools/build-test.mjs).
// W produkcji go nie ma. Cel: wersja testowa nie może dotknąć danych produkcji.
Object.assign(window.KN_CONFIG, {
  env: 'test',
  // osobny plik danych i osobny folder aplikacji na Dysku (folder rozpoznawany po znaczniku kn=test-app)
  dataFileName: 'KamienickieNutki-TEST.json',
  appFolderName: 'Kamienickie Nutki – TEST',
  // plik produkcji – tylko do ODCZYTU przyciskiem „Skopiuj dane z produkcji”
  prodDataFileName: 'KamienickieNutki.json',
  // adres produkcji (link na pasku testowym)
  prodUrl: '/Kamienickie-nutki/',
  // bez katalogu chóru: zwykły adres otwiera tryb administratora; chórzystę testujemy linkiem ?chor=<id testowy>
  publicCatalogId: '',
});

document.documentElement.dataset.env = 'test'; // inny kolor akcentu (style.css)

// Ten sam adres (zbludzakowe-zabawy.github.io) = wspólna pamięć przeglądarki z produkcją.
// Każdy klucz localStorage wersji testowej dostaje przedrostek „test~”, więc nic się nie miesza
// (logowanie, PIN, ustawienia widoku). IndexedDB rozdziela js/store.js (osobna baza).
(() => {
  const P = 'test~';
  const S = Storage.prototype;
  const isLocal = (s) => { try { return s === window.localStorage; } catch (e) { return false; } };
  const wrap = (name) => {
    const orig = S[name];
    S[name] = function (key, ...rest) { return orig.call(this, isLocal(this) ? P + key : key, ...rest); };
  };
  ['getItem', 'setItem', 'removeItem'].forEach(wrap);
})();
