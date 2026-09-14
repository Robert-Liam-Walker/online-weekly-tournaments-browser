// The Melee roster, in character-select order. `meleeId` is the game's
// external character id (CSS order), used by the wasm engine.

export interface Character {
  id: string;
  name: string;
  meleeId: number;
}

export const CHARACTERS: readonly Character[] = [
  { id: "falcon", name: "Captain Falcon", meleeId: 0 },
  { id: "dk", name: "Donkey Kong", meleeId: 1 },
  { id: "fox", name: "Fox", meleeId: 2 },
  { id: "gaw", name: "Mr. Game & Watch", meleeId: 3 },
  { id: "kirby", name: "Kirby", meleeId: 4 },
  { id: "bowser", name: "Bowser", meleeId: 5 },
  { id: "link", name: "Link", meleeId: 6 },
  { id: "luigi", name: "Luigi", meleeId: 7 },
  { id: "mario", name: "Mario", meleeId: 8 },
  { id: "marth", name: "Marth", meleeId: 9 },
  { id: "mewtwo", name: "Mewtwo", meleeId: 10 },
  { id: "ness", name: "Ness", meleeId: 11 },
  { id: "peach", name: "Peach", meleeId: 12 },
  { id: "pikachu", name: "Pikachu", meleeId: 13 },
  { id: "ics", name: "Ice Climbers", meleeId: 14 },
  { id: "puff", name: "Jigglypuff", meleeId: 15 },
  { id: "samus", name: "Samus", meleeId: 16 },
  { id: "yoshi", name: "Yoshi", meleeId: 17 },
  { id: "zelda", name: "Zelda", meleeId: 18 },
  { id: "sheik", name: "Sheik", meleeId: 19 },
  { id: "falco", name: "Falco", meleeId: 20 },
  { id: "ylink", name: "Young Link", meleeId: 21 },
  { id: "doc", name: "Dr. Mario", meleeId: 22 },
  { id: "roy", name: "Roy", meleeId: 23 },
  { id: "pichu", name: "Pichu", meleeId: 24 },
  { id: "ganon", name: "Ganondorf", meleeId: 25 },
];

export function characterById(id: string): Character | undefined {
  return CHARACTERS.find((c) => c.id === id);
}
