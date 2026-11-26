// Word grids for Imposter: each category has exactly 16 words that are similar
// enough to bluff with. Swiss spelling ("ss", never the sharp s).
// After editing, run `npm run words` to create a new database migration.

export const CATEGORIES_DE: Record<string, readonly string[]> = {
  Tiere: [
    'Hund', 'Katze', 'Pferd', 'Elefant', 'Pinguin', 'Hai', 'Adler', 'Schlange',
    'Affe', 'Löwe', 'Frosch', 'Biene', 'Schildkröte', 'Känguru', 'Wal', 'Igel',
  ],
  Essen: [
    'Pizza', 'Spaghetti', 'Sushi', 'Fondue', 'Raclette', 'Rösti', 'Burger', 'Salat',
    'Suppe', 'Lasagne', 'Curry', 'Bratwurst', 'Omelette', 'Müesli', 'Pommes frites', 'Risotto',
  ],
  'Früchte und Gemüse': [
    'Apfel', 'Banane', 'Erdbeere', 'Ananas', 'Zitrone', 'Wassermelone', 'Kirsche', 'Traube',
    'Karotte', 'Tomate', 'Gurke', 'Kartoffel', 'Zwiebel', 'Brokkoli', 'Kürbis', 'Avocado',
  ],
  Süsses: [
    'Schokolade', 'Glace', 'Gummibärli', 'Kuchen', 'Torte', 'Guetzli', 'Bonbon', 'Lollipop',
    'Kaugummi', 'Meringue', 'Crêpe', 'Waffel', 'Marshmallow', 'Lakritze', 'Pudding', 'Zuckerwatte',
  ],
  Getränke: [
    'Wasser', 'Kaffee', 'Tee', 'Milch', 'Bier', 'Wein', 'Orangensaft', 'Cola',
    'Eistee', 'Kakao', 'Champagner', 'Glühwein', 'Sirup', 'Smoothie', 'Rivella', 'Whisky',
  ],
  Sport: [
    'Fussball', 'Tennis', 'Skifahren', 'Schwimmen', 'Boxen', 'Golf', 'Basketball', 'Klettern',
    'Eishockey', 'Reiten', 'Surfen', 'Yoga', 'Schwingen', 'Fechten', 'Marathon', 'Bowling',
  ],
  Berufe: [
    'Arzt', 'Lehrer', 'Polizist', 'Koch', 'Pilot', 'Bauer', 'Coiffeur', 'Feuerwehrmann',
    'Richter', 'Bäcker', 'Gärtner', 'Zahnarzt', 'Schauspieler', 'Programmierer', 'Pöstler', 'Astronaut',
  ],
  'Orte in der Stadt': [
    'Bahnhof', 'Spital', 'Schule', 'Bibliothek', 'Kino', 'Museum', 'Restaurant', 'Supermarkt',
    'Park', 'Kirche', 'Bank', 'Post', 'Schwimmbad', 'Polizeiposten', 'Flughafen', 'Fitnesscenter',
  ],
  Länder: [
    'Schweiz', 'Italien', 'Frankreich', 'Deutschland', 'Spanien', 'Japan', 'China', 'Indien',
    'Brasilien', 'Kanada', 'Australien', 'Ägypten', 'Griechenland', 'Schweden', 'Mexiko', 'Island',
  ],
  'Städte der Welt': [
    'Paris', 'London', 'Rom', 'New York', 'Tokio', 'Berlin', 'Wien', 'Venedig',
    'Amsterdam', 'Dubai', 'Sydney', 'Barcelona', 'Moskau', 'Las Vegas', 'Kairo', 'Rio de Janeiro',
  ],
  'Reiseziele in der Schweiz': [
    'Zürich', 'Bern', 'Basel', 'Genf', 'Luzern', 'Lugano', 'Zermatt', 'Davos',
    'Interlaken', 'St. Moritz', 'Locarno', 'Jungfraujoch', 'Rheinfall', 'Rigi', 'St. Gallen', 'Chur',
  ],
  Fahrzeuge: [
    'Auto', 'Velo', 'Zug', 'Tram', 'Bus', 'Flugzeug', 'Helikopter', 'U-Boot',
    'Motorrad', 'Traktor', 'Segelschiff', 'Rakete', 'Trottinett', 'Seilbahn', 'Heissluftballon', 'Lastwagen',
  ],
  Haushalt: [
    'Kühlschrank', 'Staubsauger', 'Waschmaschine', 'Toaster', 'Bügeleisen', 'Föhn', 'Backofen', 'Mixer',
    'Besen', 'Wecker', 'Lampe', 'Spiegel', 'Fernseher', 'Zahnbürste', 'Pfanne', 'Korkenzieher',
  ],
  Möbel: [
    'Tisch', 'Stuhl', 'Sofa', 'Bett', 'Schrank', 'Regal', 'Sessel', 'Hocker',
    'Kommode', 'Schreibtisch', 'Garderobe', 'Liegestuhl', 'Hängematte', 'Wiege', 'Bank', 'Vitrine',
  ],
  Kleidung: [
    'Hose', 'Pullover', 'Jacke', 'Socken', 'Schuhe', 'Mütze', 'Schal', 'Handschuhe',
    'Krawatte', 'Badehose', 'Pyjama', 'Gürtel', 'Rock', 'Stiefel', 'Flipflops', 'Anzug',
  ],
  Musikinstrumente: [
    'Gitarre', 'Klavier', 'Geige', 'Schlagzeug', 'Flöte', 'Trompete', 'Saxophon', 'Harfe',
    'Akkordeon', 'Alphorn', 'Mundharmonika', 'Orgel', 'Cello', 'Dudelsack', 'Triangel', 'Ukulele',
  ],
  Natur: [
    'Berg', 'See', 'Fluss', 'Wald', 'Wüste', 'Insel', 'Vulkan', 'Gletscher',
    'Höhle', 'Wasserfall', 'Strand', 'Wiese', 'Meer', 'Dschungel', 'Sumpf', 'Schlucht',
  ],
  'Wetter und Himmel': [
    'Sonne', 'Mond', 'Stern', 'Regen', 'Schnee', 'Hagel', 'Nebel', 'Gewitter',
    'Blitz', 'Regenbogen', 'Wolke', 'Sturm', 'Föhn', 'Komet', 'Polarlicht', 'Frost',
  ],
  Körper: [
    'Auge', 'Ohr', 'Nase', 'Mund', 'Zahn', 'Zunge', 'Haar', 'Hand',
    'Fuss', 'Knie', 'Ellbogen', 'Herz', 'Gehirn', 'Magen', 'Bauchnabel', 'Daumen',
  ],
  'Feste und Anlässe': [
    'Weihnachten', 'Ostern', 'Geburtstag', 'Hochzeit', 'Silvester', 'Fasnacht', 'Halloween', '1. August',
    'Samichlaus', 'Valentinstag', 'Muttertag', 'Taufe', 'Beerdigung', 'Schulabschluss', 'Sechseläuten', 'Openair',
  ],
  Freizeit: [
    'Wandern', 'Campen', 'Kochen', 'Lesen', 'Gärtnern', 'Angeln', 'Tanzen', 'Malen',
    'Fotografieren', 'Gamen', 'Basteln', 'Singen', 'Shoppen', 'Grillieren', 'Puzzeln', 'Stricken',
  ],
  'Märchen und Fantasie': [
    'Drache', 'Einhorn', 'Hexe', 'Zauberer', 'Vampir', 'Gespenst', 'Zwerg', 'Riese',
    'Meerjungfrau', 'Werwolf', 'Fee', 'Zombie', 'Prinzessin', 'Ritter', 'Troll', 'Mumie',
  ],
  Schule: [
    'Wandtafel', 'Schulsack', 'Lineal', 'Schere', 'Leim', 'Füller', 'Radiergummi', 'Zirkel',
    'Taschenrechner', 'Znüni', 'Pause', 'Prüfung', 'Hausaufgaben', 'Zeugnis', 'Turnhalle', 'Stundenplan',
  ],
  'Ferien und Reisen': [
    'Koffer', 'Reisepass', 'Zelt', 'Hotel', 'Sonnencreme', 'Postkarte', 'Souvenir', 'Landkarte',
    'Rucksack', 'Kreuzfahrt', 'Liegestuhl', 'Flugticket', 'Stau', 'Jetlag', 'Kamera', 'Badetuch',
  ],
  Technik: [
    'Computer', 'Handy', 'Kopfhörer', 'Drucker', 'Maus', 'Tastatur', 'Bildschirm', 'Roboter',
    'Drohne', 'Ladekabel', 'Lautsprecher', 'Smartwatch', 'Router', 'Spielkonsole', 'Batterie', 'Mikrofon',
  ],
}
