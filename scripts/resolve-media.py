"""Local Resolve bridge. JSON in environment; never executes user-supplied code."""
import json
import math
import os
import sys


def timecode_frame(tc, fps):
    nominal = round(fps)
    parts = tc.replace(';', ':').split(':')
    if len(parts) != 4:
        raise ValueError('无法读取播放头时间码')
    h, m, s, f = [int(v) for v in parts]
    frame = ((h * 60 + m) * 60 + s) * nominal + f
    if ';' in tc:
        if nominal not in (30, 60):
            raise ValueError('暂不支持此丢帧时间码')
        minutes = h * 60 + m
        frame -= round(nominal * .0666666667) * (minutes - minutes // 10)
    return frame


def status(resolve, project, timeline):
    return {'ok': True, 'connected': True, 'version': resolve.GetVersionString(),
            'project': project.GetName() if project else None,
            'projectId': project.GetUniqueId() if project else None,
            'timeline': timeline.GetName() if timeline else None,
            'timelineId': timeline.GetUniqueId() if timeline else None,
            'playhead': timeline.GetCurrentTimecode() if timeline else None,
            'fps': timeline.GetSetting('timelineFrameRate') if timeline else None,
            'tracks': {kind: [{'index': i, 'name': timeline.GetTrackName(kind, i),
                              'locked': timeline.GetIsTrackLocked(kind, i)}
                             for i in range(1, timeline.GetTrackCount(kind) + 1)]
                       if timeline else [] for kind in ['video', 'audio']}}


def import_clip(resolve, project, timeline, request):
    if not project or not timeline:
        raise ValueError('请先在达芬奇中打开工程与时间线')
    if project.GetUniqueId() != request['projectId'] or timeline.GetUniqueId() != request['timelineId']:
        raise ValueError('达芬奇工程或时间线已经切换，请刷新连接后再导入')
    fps = float(timeline.GetSetting('timelineFrameRate'))
    record = int(timeline.GetEndFrame()) if request['position'] == 'end' else timecode_frame(timeline.GetCurrentTimecode(), fps)
    if record < timeline.GetStartFrame():
        raise ValueError('播放头位于时间线起点之前')
    kinds = ['audio'] if request['kind'] == 'audio' else ['video']
    if request['kind'] == 'video' and request['videoMode'] == 'both':
        kinds.append('audio')
    # Validate destination before even adding the file to the media pool.
    for kind in kinds:
        track = request[kind + 'Track']
        if track > timeline.GetTrackCount(kind) or timeline.GetIsTrackLocked(kind, track):
            raise ValueError('所选轨道不存在或已锁定，请刷新连接并重新选择')
    pool = project.GetMediaPool()
    clips = pool.ImportMedia([request['path']])
    if not clips:
        raise ValueError('达芬奇无法读取此素材，未写入时间线')
    clip = clips[0]
    props = clip.GetClipProperty()
    if 'audio' in kinds and request['kind'] == 'video' and not int(props.get('Audio Ch', '0') or 0):
        kinds.remove('audio')
    # Timeline duration uses timeline FPS; source endFrame uses source FPS.
    source_fps = float(props.get('FPS') or fps)
    frames = int(float(str(props.get('Frames') or '0').replace(',', '')))
    if request['kind'] == 'audio':
        # Resolve leaves Frames blank for audio. Append the whole source; the
        # rounded display timecode is only a conservative collision bound.
        duration = timecode_frame(props.get('Duration', ''), source_fps) + 2
    else:
        if frames <= 0:
            raise ValueError('无法确认素材长度，素材已进入媒体池，未写入时间线')
        duration = max(1, math.ceil(frames * fps / source_fps))
    if request['kind'] == 'image':
        frames = max(1, round(source_fps * 5))
        duration = max(1, round(fps * 5))
    for kind in kinds:
        for item in timeline.GetItemListInTrack(kind, request[kind + 'Track']) or []:
            if item.GetStart() < record + duration and item.GetEnd() > record:
                raise ValueError('目标位置与已有片段重叠，已保留原片段。请改选时间线末尾或空轨道；素材已进入媒体池。')
    if project.GetUniqueId() != request['projectId'] or project.GetCurrentTimeline().GetUniqueId() != request['timelineId']:
        raise ValueError('导入前时间线已切换，请刷新连接后重试')
    infos = [{'mediaPoolItem': clip, 'startFrame': 0, 'endFrame': frames - 1,
              'mediaType': 2 if kind == 'audio' else 1,
              'trackIndex': request[kind + 'Track'], 'recordFrame': record} for kind in kinds]
    if request['kind'] != 'image':
        # Full clips must omit source limits: Resolve can round explicit limits
        # at mixed source/timeline rates and truncate the last frames.
        for info in infos:
            info.pop('startFrame')
            info.pop('endFrame')
    try:
        inserted = pool.AppendToTimeline(infos) or []
        if len(inserted) != len(infos):
            return {'ok': False, 'uncertain': True, 'error': '达芬奇未完整返回导入结果，请检查时间线后再操作，避免重复导入。'}
        actual = [{'name': item.GetName(), 'start': item.GetStart(), 'end': item.GetEnd(),
                   'track': item.GetTrackTypeAndIndex()} for item in inserted]
        if any(abs(item['start'] - record) > 1 or item['track'] != [kind, request[kind + 'Track']] for item, kind in zip(actual, kinds)):
            return {'ok': False, 'uncertain': True, 'error': '素材已写入，但实际位置与请求不一致，请检查时间线。', 'items': actual}
        linked = timeline.SetClipsLinked(inserted, True) if len(inserted) > 1 else True
        return {'ok': True, 'warning': '' if linked else '素材已导入，但音画链接未成功，请在达芬奇核对。', 'project': project.GetName(), 'timeline': timeline.GetName(), 'items': actual,
                'message': '已导入「' + timeline.GetName() + '」', 'saved': False}
    except Exception:
        return {'ok': False, 'uncertain': True, 'error': '导入结果未确认，请先检查达芬奇时间线，不要重复点击。'}


def main():
    request = json.loads(os.environ['MAMBA_RESOLVE_REQUEST'])
    sys.path.insert(0, '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules')
    import DaVinciResolveScript
    resolve = DaVinciResolveScript.scriptapp('Resolve')
    if not resolve:
        raise ValueError('达芬奇未连接。请打开工程，并在偏好设置中启用本地外部脚本。')
    project = resolve.GetProjectManager().GetCurrentProject()
    timeline = project.GetCurrentTimeline() if project else None
    if request.get('action') == 'status':
        return status(resolve, project, timeline)
    if request.get('action') == 'import':
        return import_clip(resolve, project, timeline, request)
    raise ValueError('未知操作')


if __name__ == '__main__':
    try:
        result = main()
    except ValueError as exc:
        result = {'ok': False, 'error': str(exc)}
    except Exception:
        result = {'ok': False, 'error': '达芬奇脚本连接失败，请检查本地外部脚本设置。'}
    print(json.dumps(result, ensure_ascii=False))
