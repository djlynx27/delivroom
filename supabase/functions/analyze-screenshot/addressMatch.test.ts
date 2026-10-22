import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { fuzzyMatchAddress, type MatchableZone } from './addressMatch.ts';

const zones: MatchableZone[] = [
  { id: 'mtl-mr', name: 'Avenue Mont-Royal', city_id: 'mtl' },
  { id: 'mtl-mcgill', name: 'Université McGill', city_id: 'mtl' },
  { id: 'mtl-jt', name: 'Station Jean-Talon', city_id: 'mtl' },
  { id: 'lvl-carrefour', name: 'Carrefour Laval', city_id: 'lvl' },
  { id: 'lng-hcl', name: 'Hôpital Charles-Le Moyne', city_id: 'lng' },
];
const idOf = (a: string) => fuzzyMatchAddress(a, zones)?.id ?? null;

Deno.test('Mont-Royal zone: real Mont-Royal streets still match', () => {
  assertEquals(idOf('Avenue du Mont-Royal E & Rue St-Denis, Montréal'), 'mtl-mr');
  assertEquals(idOf('Avenue Beloeil & Boulevard Mont-Royal, Outremont'), 'mtl-mr');
});

Deno.test('Mont-Royal zone: no match on streets/suburbs that merely contain "mont"', () => {
  for (const a of [
    'Avenue Lamont & Boulevard des Trinitaires, Montréal',
    'Rue de Montigny O & Rue St-Urbain, Montréal',
    'Rue Montcalm & Rue Notre-Dame E, Montréal',
    'Rue de la Montagne & Rue St-Antoine O, Montréal',
    'Avenue Beaumont & Avenue de l\'Épée, Montréal',
    'Avenue Durocher & Rue Beaubien O, Outremont',
    '10e Avenue & Rue Masson, Rosemont',
    'Ballantyne & Courtney, Montreal West',
  ]) assertEquals(idOf(a), null, a);
});

Deno.test('Mont-Royal zone: the separate town of Mont-Royal is not Avenue Mont-Royal', () => {
  assertEquals(idOf('Avenue Lockhart & Chemin Selwood, Mont-Royal'), null);
});

Deno.test('other zones keep matching', () => {
  assertEquals(idOf('Station Jean-Talon, Montréal'), 'mtl-jt');
  assertEquals(idOf('Carrefour Laval, Laval'), 'lvl-carrefour');
  assertEquals(idOf('Université McGill, Montréal'), 'mtl-mcgill');
});
