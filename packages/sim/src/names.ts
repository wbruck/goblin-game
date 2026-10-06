const FIRST = ["Grub", "Snik", "Mog", "Wort", "Zib", "Krag", "Fizz", "Nob", "Blat", "Skrit",
  "Gnash", "Durg", "Pip", "Vex", "Ook", "Snaggle", "Burp", "Twitch", "Mungo", "Yip"];
const LAST = ["Toe-biter", "Mudfoot", "Shinyeye", "Rotgut", "Earwig", "Stinkfinger",
  "Bogsnout", "Nailchewer", "Grimtooth", "Pebblehead"];

export function goblinName(a: number, b: number): string {
  return `${FIRST[a % FIRST.length]} ${LAST[b % LAST.length]}`;
}
