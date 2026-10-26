import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
path = ROOT / 'worker' / 'parcel_bridge.py'
spec = importlib.util.spec_from_file_location('parcel_bridge', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

SAMPLE = {'type':'Feature','properties':{
    'ilAd':'Ankara','ilceAd':'Çankaya','mahalleAd':'Kızılay',
    'adaNo':'12','parselNo':'3','nitelik':'Arsa','alan':'1.234,56','pafta':'M20'},
    'geometry':{'type':'Polygon','coordinates':[[[32.8,39.9],[32.81,39.9],[32.81,39.91],[32.8,39.9]]]}}


class FakeResponse:
    def __init__(self, code, payload):
        self.status_code = code
        self.payload = payload
        self.content = json.dumps(payload).encode('utf-8')
        self.ok = 200 <= code <= 299
    def json(self):
        return self.payload


class FakeClient:
    def __init__(self, *args, **kwargs):
        pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def get_provinces(self): return [mod.Province(6,'ANKARA')]
    def get_districts(self, prov): return [mod.District(11,'ÇANKAYA')]
    def get_neighborhoods(self, dist): return [mod.Neighborhood(22,'KIZILAY')]
    def get_parcel(self, nid, block, parsel):
        assert (nid,block,parsel)==(22,12,3)
        return mod.Parcel.from_response(SAMPLE,nid,block,parsel)
    def get_parcel_by_coordinate(self, lat, lon):
        return mod.Parcel.from_response(SAMPLE,0,0,0)


class TestBridge(unittest.TestCase):
    def test_public_mode_no_token_sends_parcel_query(self):
        with patch.dict(os.environ,{'TKGM_TOKEN':'','TKGM_PARCEL_MODE':'public'}),patch.object(mod,'DirectTKGMClient',FakeClient):
            d = mod.handle({'action':'parcel','neighborhoodId':22,'block':'12','parcel':'3'})
        self.assertTrue(d['ok']); self.assertEqual(d['parcel']['areaM2'],1234.56)
        self.assertEqual(d['parcel']['geometry']['geometry']['type'],'Polygon')

    def test_admin_region_lists(self):
        with patch.object(mod,'DirectTKGMClient',FakeClient):
            result=mod.handle({'action':'provinces'})
        self.assertEqual(result['items'],[{'id':6,'name':'ANKARA'}])

    def test_names_exact(self):
        with patch.object(mod,'DirectTKGMClient',FakeClient):
            result=mod.handle({'action':'parcel','province':'Ankara','district':'Çankaya','neighborhood':'Kızılay','block':'12','parcel':'3'})
        self.assertTrue(result['ok'])

    def test_invalid_numbers_rejected(self):
        for value in ('0','-1','2.0','12x','',True):
            with self.assertRaises(ValueError): mod.parse_integer(value,'Ada')

    def test_public_mode_no_authorization_header(self):
        with patch.dict(os.environ,{'TKGM_TOKEN':'','TKGM_PARCEL_MODE':'public','TKGM_API_BASE':''}):
            c=mod.DirectTKGMClient()
        self.assertNotIn('Authorization',c.session.headers)
        self.assertNotIn('Referer',c.session.headers)
        self.assertNotIn('Origin',c.session.headers)
        self.assertEqual(c.base,mod.PUBLIC_BASE)
        c.session.close()

    def test_authorized_mode_requires_token(self):
        with patch.dict(os.environ,{'TKGM_TOKEN':'','TKGM_PARCEL_MODE':'authorized'}):
            with self.assertRaises(mod.TKGMAuthError): mod.DirectTKGMClient()
        with patch.dict(os.environ,{'TKGM_PARCEL_MODE':'authorized','TKGM_API_BASE':''}):
            c=mod.DirectTKGMClient(token='FAKE_TEST_VALUE')
        self.assertEqual(c.session.headers['Authorization'],'Bearer FAKE_TEST_VALUE')
        c.session.close()

    def test_no_arbitrary_upstream_host(self):
        with patch.dict(os.environ,{'TKGM_PARCEL_MODE':'public','TKGM_API_BASE':'http://localhost:3001/evil'}):
            with self.assertRaises(ValueError): mod.DirectTKGMClient()

    def test_real_path_without_live_network(self):
        with patch.dict(os.environ,{'TKGM_PARCEL_MODE':'public','TKGM_API_BASE':''}):
            with mod.DirectTKGMClient() as c:
                with patch.object(c.session,'get',return_value=FakeResponse(200,SAMPLE)) as req:
                    p=c.get_parcel(22,12,3)
                self.assertEqual(p.properties['adaNo'],'12')
                self.assertEqual(req.call_args.args[0],mod.PUBLIC_BASE+'/parsel/22/12/3')

    def test_403_is_not_bypassed(self):
        with patch.dict(os.environ,{'TKGM_PARCEL_MODE':'public','TKGM_API_BASE':''}):
            with mod.DirectTKGMClient() as c:
                with patch.object(c.session,'get',return_value=FakeResponse(403,{'Message':'denied'})) as req:
                    with self.assertRaises(mod.TKGMAuthError): c.get_parcel(22,12,3)
                self.assertEqual(req.call_count,1)

    def test_response_ids_must_match(self):
        wrong=json.loads(json.dumps(SAMPLE)); wrong['properties']['adaNo']='999'
        class WrongClient(FakeClient):
            def get_parcel(self,nid,block,parcel):return mod.Parcel.from_response(wrong,nid,block,parcel)
        with patch.object(mod,'DirectTKGMClient',WrongClient):
            with self.assertRaises(mod.TKGMNotFoundError): mod.handle({'action':'parcel','neighborhoodId':22,'block':'12','parcel':'3'})

    def test_coordinate_opt_in(self):
        with patch.dict(os.environ,{'TKGM_COORDINATE_ENABLED':'false'}):
            self.assertEqual(mod.handle({'action':'coordinate','lat':39.9,'lng':32.8})['code'],'DISABLED')
        with patch.dict(os.environ,{'TKGM_COORDINATE_ENABLED':'true'}),patch.object(mod,'DirectTKGMClient',FakeClient):
            self.assertTrue(mod.handle({'action':'coordinate','lat':39.9,'lng':32.8})['ok'])

    def test_cli_not_synthetic_token_required(self):
        # Bad numbers should be rejected before a live connection in future changes.
        result=subprocess.run([sys.executable,str(path)],input=json.dumps({'action':'coordinate','lat':39.9,'lng':32.8}),
                              text=True,capture_output=True,env={**os.environ,'TKGM_TOKEN':'','TKGM_COORDINATE_ENABLED':'false'},timeout=10)
        self.assertEqual(result.returncode,0)
        self.assertEqual(json.loads(result.stdout)['code'],'DISABLED')

    def test_no_blank_geometry(self):
        no_geom=mod.Parcel.from_response({'type':'Feature','properties':{'adaNo':'12','parselNo':'3'},'geometry':None},22,12,3)
        with self.assertRaises(mod.TKGMNotFoundError): mod.parcel_result(no_geom,'ada-parsel')

    def test_region_boundary_passthrough(self):
        ring=[[33.1,39.8],[33.3,39.8],[33.3,40.0],[33.1,39.8]]
        class GeoClient(FakeClient):
            def get_districts(self, prov):
                return [mod.District(11,'ELMADAĞ',geometry=mod.Geometry('Polygon',[ring])),mod.District(12,'ÇANKAYA')]
        with patch.object(mod,'DirectTKGMClient',GeoClient):
            items=mod.handle({'action':'districts','provinceId':6})['items']
        self.assertEqual(items[0]['geometry'],{'type':'Polygon','coordinates':[ring]})
        self.assertNotIn('geometry',items[1])

    def test_analysis_request_and_validation(self):
        rows=[{'parselId':1,'enlem':40.0,'boylam':32.3,'sayi':2,'extra':'x'},'bad']
        with patch.dict(os.environ,{'TKGM_PARCEL_MODE':'public','TKGM_API_BASE':''}):
            with mod.DirectTKGMClient() as c:
                with patch.object(c.session,'get',return_value=FakeResponse(200,rows)) as req, patch.object(mod,'DirectTKGMClient',lambda **k:c):
                    out=mod.handle({'action':'analysis','analysisType':1,'year':2025,'districtId':161})
                self.assertEqual(req.call_args.args[0],mod.ANALYSIS_URL)
                self.assertEqual(req.call_args.kwargs['params'],{'AnalizTip':1,'Yil':2025,'IlceId':161})
                self.assertNotIn('Origin',c.session.headers)
        self.assertEqual(out['rows'],[{'parselId':1,'enlem':40.0,'boylam':32.3,'sayi':2}])
        for bad in ({'analysisType':9,'year':2025,'districtId':1},{'analysisType':1,'year':1999,'districtId':1},{'analysisType':1,'year':2025,'districtId':'1;x'}):
            with patch.object(mod,'DirectTKGMClient',FakeClient):
                with self.assertRaises(ValueError): mod.handle({'action':'analysis',**bad})

if __name__=='__main__': unittest.main()
