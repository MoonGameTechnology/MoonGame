import json, collections
ROWS = [
    (-450, [(-390,'a1'), (-130,'a2'), (130,'a3'), (390,'a4')]),
    (-225, [(-520,'b1'), (-260,'b2'), (0,'b3'), (260,'b4'), (520,'b5')]),
    (0,    [(-390,'c1'), (-130,'c2'), (130,'c3'), (390,'c4')]),
    (225,  [(-520,'d1'), (-260,'d2'), (0,'d3'), (260,'d4'), (520,'d5')]),
    (450,  [(-390,'e1'), (-130,'e2'), (130,'e3'), (390,'e4')]),
    # Ряд F — КАРМАН КЛАДБИЩА, добавлен под задачу сбора материалов (решение владельца
    # 2026-09-22: «можно под эти миссии новые области добавить»). Держится на том же
    # шаге решётки, поэтому перелёты туда такие же короткие, как везде.
    (675,  [(-260,'f1'), (0,'f2'), (260,'f3')]),
]
S = 'swarm'
# вид, местность, владелец, гарнизон, постройки
SPEC = {
 'a1': ('planet','empty_space','p1',[{'unit':'militia','count':2}],[{'type':'mine_t1'},{'type':'shipyard','level':2},{'type':'radar'}]),
 'a2': ('nebula','nebula','p1',[],[]),
 'a3': ('nebula','nebula',S,[{'unit':'swarm_lander','count':2}],[]),
 'a4': ('asteroid','asteroid_field',None,[],[]),
 'b1': ('asteroid','asteroid_field',None,[],[]),
 'b2': ('empty','deep_void',None,[],[]),
 'b3': ('empty','deep_void',None,[],[]),
 'b4': ('asteroid','dust_lane',None,[],[]),
 'b5': ('asteroid_cluster','asteroid_cluster',S,[{'unit':'swarm_lander','count':3}],[]),
 'c1': ('dead_world','depleted_system',S,[{'unit':'swarm_lander','count':3}],[]),
 'c2': ('graveyard','derelict_graveyard',S,[],[]),
 'c3': ('empty','deep_void',None,[],[]),
 'c4': ('solar_flare','solar_flare_zone',None,[],[]),
 'd1': ('planet','empty_space',S,[{'unit':'swarm_lander','count':4}],[{'type':'biomass_pit'},{'type':'shipyard','level':2},{'type':'fort'}]),
 'd2': ('empty','deep_void',None,[],[]),
 'd3': ('empty','empty_space',None,[],[]),
 'd4': ('graveyard','derelict_graveyard',S,[{'unit':'swarm_lander','count':2}],[]),
 'd5': ('ion_storm','ion_storm',None,[],[]),
 'e1': ('asteroid','asteroid_field',S,[],[]),
 'e2': ('planet','empty_space',S,[{'unit':'swarm_lander','count':4}],[{'type':'swarm_synapse'},{'type':'shipyard','level':2},{'type':'orbital_aa'}]),
 'e3': ('empty','empty_space',None,[],[]),
 'e4': ('planet','empty_space',S,[{'unit':'swarm_lander','count':6}],[{'type':'swarm_hive'},{'type':'biomass_pit'},{'type':'shipyard','level':2},{'type':'barracks'},{'type':'fort'},{'type':'orbital_aa'}]),
  'f1': ('graveyard','derelict_graveyard',S,[{'unit':'swarm_lander','count':2}],[]),
  'f2': ('graveyard','derelict_graveyard',None,[],[]),
  'f3': ('graveyard','derelict_graveyard',S,[],[]),
}
# Размеры НЕ трогаем: решётка уже даёт узлам шесть подходов, а раздутая клетка
# отнимает границы у соседей — первым делом горизонтальные внутри ряда.
SIZE = {}
# Двойной путь: через центральный перекрёсток идут ДВЕ трассы и не соединяются.
# Две трассы пересекаются в центре и НЕ соединяются (M2.5): по диагоналям.
TRANSIT = {'c1': [['b1','d2'], ['b2','d1']]}

# РАСШАТЫВАНИЕ ЦЕНТРОВ (M2.9, решение владельца «в космосе нет прямых углов»). Сдвиг
# детерминированный — от id провинции, а не от случайного числа: карта обязана собираться
# одинаково у всех и в любой момент. Амплитуда 90 мировых единиц взята замером: до неё
# число проходов, средний перелёт и обоснованный тупик держатся, а на 130 ломается транзит.
JITTER = 90
# Соль сдвига выбрана ПЕРЕБОРОМ по замеру, а не на глаз: из девяти вариантов этот
# единственный держит 40 проходов, единственный тупик (и тот обоснован скоплением
# астероидов) и чистый валидатор. Соседние варианты ломали транзит `c1` или заводили
# второй тупик на просторной местности — то есть тупик без обоснования.
SALT = 'a'
def shake(sid):
    h = 2166136261
    for ch in (sid + SALT):
        h ^= ord(ch); h = (h * 16777619) & 0xFFFFFFFF
    def nxt():
        nonlocal h
        h ^= (h >> 15); h = (h * 2246822507) & 0xFFFFFFFF
        h ^= (h >> 13); h = (h * 3266489909) & 0xFFFFFFFF
        return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF
    return round((nxt()*2-1)*JITTER), round((nxt()*2-1)*JITTER)

sectors = collections.OrderedDict()
for y,row in ROWS:
    for x,sid in row:
        dx,dy = shake(sid)
        x, y0 = x+dx, y+dy
        kind,terrain,owner,garr,blds = SPEC[sid]
        sec = collections.OrderedDict([('position',{'x':x,'y':y0}),('kind',kind),('terrain',terrain)])
        if sid in SIZE: sec['size']=SIZE[sid]
        if owner: sec['owner']=owner
        if blds: sec['buildings']=blds
        if garr: sec['garrison']=garr
        if sid in TRANSIT: sec['transit']=TRANSIT[sid]
        sectors[sid]=sec

# ЗАДАЧИ ЗАБЕГА — три разных ГЛАГОЛА, иначе они сольются в одну: взять, снести, пройти.
OBJECTIVES = [
  collections.OrderedDict([('id','mission.salvage'),('kind','control'),
                           ('targets',['c2','d4','f1','f3']),('reward',3)]),
  collections.OrderedDict([('id','mission.raze-biomass'),('kind','raze'),
                           ('targets',['biomass_pit']),('reward',3)]),
  collections.OrderedDict([('id','mission.recon'),('kind','scout'),
                           ('count',14),('reward',2)]),
]

m = collections.OrderedDict([
 ('id','pve-2'),('seed','pve-2'),('time',0),('mode','pve_waves'),
 ('sectors',sectors),
 ('objectives',OBJECTIVES),
 ('players', collections.OrderedDict([
   ('p1', {'name':'Azure Compact','faction':'vanguard','resources':{'credits':400,'metal':400}}),
   ('swarm', {'name':'Swarm Collective','faction':'swarm','ai':True,
              'resources':{'credits':800,'metal':800,'biomass':300,'microelectronics':80}}),
 ])),
 ('fleets', collections.OrderedDict([
   ('p1_1', {'owner':'p1','location':'a1','landing':[{'unit':'militia','count':1}],
             'units':[{'unit':'cruiser','count':2},{'unit':'scout_drone','count':1}]}),
   ('swarm_1', {'owner':'swarm','location':'e4','units':[{'unit':'swarm_brood_mother','count':2}]}),
   ('swarm_2', {'owner':'swarm','location':'d1','units':[{'unit':'swarm_brood_mother','count':1}]}),
 ])),
])
open('/home/user/MoonGame/data/maps/pve-2.json','w',encoding='utf-8').write(json.dumps(m,indent=2,ensure_ascii=False)+'\n')
print('провинций:', len(sectors))
