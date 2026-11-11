import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('bridge',Path(__file__).with_name('resolve-media.py'))
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)

class Item:
 def GetStart(self): return 108000
 def GetEnd(self): return 108060
class Timeline:
 def __init__(self): self.locked=False;self.overlap=False
 def GetUniqueId(self): return 't'
 def GetSetting(self,key): return 29.97
 def GetEndFrame(self): return 108000
 def GetStartFrame(self): return 108000
 def GetTrackCount(self,kind): return 1
 def GetIsTrackLocked(self,kind,track): return self.locked
 def GetItemListInTrack(self,kind,track): return [Item()] if self.overlap else []
class Pool:
 def __init__(self): self.called=0;self.infos=[]
 def ImportMedia(self,paths): self.called+=1;return [self]
 def GetClipProperty(self): return {'FPS':29.97,'Frames':'','Duration':'00:00:01:29'}
 def AppendToTimeline(self,infos): self.infos=infos;return []
class Project:
 def __init__(self): self.pool=Pool();self.timeline=Timeline()
 def GetUniqueId(self): return 'p'
 def GetMediaPool(self): return self.pool
 def GetCurrentTimeline(self): return self.timeline

class Tests(unittest.TestCase):
 def setUp(self):
  self.p=Project();self.req={'projectId':'p','timelineId':'t','position':'end','kind':'audio','path':'/test.wav','audioTrack':1,'videoTrack':1,'videoMode':'both'}
 def run_import(self): return bridge.import_clip(None,self.p,self.p.timeline,self.req)
 def test_dropframe(self):
  self.assertEqual(bridge.timecode_frame('01:00:00;00',29.97),107892)
  self.assertEqual(bridge.timecode_frame('01:00:00:00',29.97),108000)
  self.assertEqual(bridge.timecode_frame('01:00:00;00',59.94),215784)
 def test_stale_timeline(self):
  self.req['timelineId']='other'
  with self.assertRaises(ValueError):self.run_import()
  self.assertEqual(self.p.pool.called,0)
 def test_locked(self):
  self.p.timeline.locked=True
  with self.assertRaises(ValueError):self.run_import()
  self.assertEqual(self.p.pool.called,0)
 def test_overlap(self):
  self.p.timeline.overlap=True
  with self.assertRaises(ValueError):self.run_import()
  self.assertEqual(self.p.pool.infos,[])
 def test_full_video_preserves_source(self):
  self.req['kind']='video';self.req['videoMode']='video'
  self.p.pool.GetClipProperty=lambda: {'FPS':25, 'Frames':'50', 'Audio Ch':'1'}
  result=self.run_import();self.assertTrue(result['uncertain'])
  self.assertNotIn('endFrame',self.p.pool.infos[0])
 def test_full_audio_and_partial_result(self):
  result=self.run_import();self.assertTrue(result['uncertain'])
  self.assertNotIn('endFrame',self.p.pool.infos[0]);self.assertEqual(self.p.pool.infos[0]['mediaType'],2)

if __name__=='__main__':unittest.main()
