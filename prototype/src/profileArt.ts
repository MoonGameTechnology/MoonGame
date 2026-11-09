import p1 from '../../art/profile/portrait-01.webp';
import p2 from '../../art/profile/portrait-02.webp';
import p3 from '../../art/profile/portrait-03.webp';
import p4 from '../../art/profile/portrait-04.webp';
import p5 from '../../art/profile/portrait-05.webp';
import p6 from '../../art/profile/portrait-06.webp';
import p7 from '../../art/profile/portrait-07.webp';
import p8 from '../../art/profile/portrait-08.webp';
import p9 from '../../art/profile/portrait-09.webp';
import p10 from '../../art/profile/portrait-10.webp';
import p11 from '../../art/profile/portrait-11.webp';
import p12 from '../../art/profile/portrait-12.webp';
import p13 from '../../art/profile/portrait-13.webp';
import p14 from '../../art/profile/portrait-14.webp';
import p15 from '../../art/profile/portrait-15.webp';
import p16 from '../../art/profile/portrait-16.webp';
import p17 from '../../art/profile/portrait-17.webp';
import p18 from '../../art/profile/portrait-18.webp';
import p19 from '../../art/profile/portrait-19.webp';
import p20 from '../../art/profile/portrait-20.webp';
import p21 from '../../art/profile/portrait-21.webp';
import p22 from '../../art/profile/portrait-22.webp';
import p23 from '../../art/profile/portrait-23.webp';
import p24 from '../../art/profile/portrait-24.webp';
import p25 from '../../art/profile/portrait-25.webp';
import p26 from '../../art/profile/portrait-26.webp';
import p27 from '../../art/profile/portrait-27.webp';
import p28 from '../../art/profile/portrait-28.webp';
import p29 from '../../art/profile/portrait-29.webp';
import p30 from '../../art/profile/portrait-30.webp';
import p31 from '../../art/profile/portrait-31.webp';
import p32 from '../../art/profile/portrait-32.webp';
import p33 from '../../art/profile/portrait-33.webp';
import p34 from '../../art/profile/portrait-34.webp';
import p35 from '../../art/profile/portrait-35.webp';
import p36 from '../../art/profile/portrait-36.webp';
import p37 from '../../art/profile/portrait-37.webp';
import p38 from '../../art/profile/portrait-38.webp';
import p39 from '../../art/profile/portrait-39.webp';
import p40 from '../../art/profile/portrait-40.webp';
import medals from '../../art/profile/medals.webp';
import contribution from '../assets/contribution-medal.svg';
import tutorial from '../assets/tutorial-medal.svg';
// The build inlines an SVG as a percent-encoded data URL that keeps its quote marks, and
// these URLs go into HTML attributes and CSS url('…'): both quotes are encoded as well.
const quoteSafe = (url: string): string => url.replace(/"/g, '%22').replace(/'/g, '%27');
export const CONTRIBUTION_MEDAL = quoteSafe(contribution);
export const TUTORIAL_MEDAL = quoteSafe(tutorial);
export const PORTRAITS = [
  p1,
  p2,
  p3,
  p4,
  p5,
  p6,
  p7,
  p8,
  p9,
  p10,
  p11,
  p12,
  p13,
  p14,
  p15,
  p16,
  p17,
  p18,
  p19,
  p20,
  p21,
  p22,
  p23,
  p24,
  p25,
  p26,
  p27,
  p28,
  p29,
  p30,
  p31,
  p32,
  p33,
  p34,
  p35,
  p36,
  p37,
  p38,
  p39,
  p40,
] as const;
export const MEDAL_ATLAS = medals;
