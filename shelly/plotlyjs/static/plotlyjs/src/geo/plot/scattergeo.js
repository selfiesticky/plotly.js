'use strict';

/* global d3:false */

var Plotly = require('../../plotly'),
    getFromTopojson = require('../lib/get-from-topojson');

var plotScatterGeo = module.exports = {};

plotScatterGeo.calcGeoJSON = function(trace, topojson) {
    var cdi = [],
        marker = trace.marker || {};

    var N, fromTopojson, features, ids, getLonLat, lonlat, indexOfId;

    if(trace.locations) {
        N = trace.locations.length;
        fromTopojson = getFromTopojson(trace, topojson);
        features = fromTopojson.features;
        ids = fromTopojson.ids;
        getLonLat = function(trace, i) {
            indexOfId = ids.indexOf(trace.locations[i]);
            if(indexOfId === -1) return;
            return features[indexOfId].properties.centroid;
        };
    }
    else {
        N = trace.lon.length;
        getLonLat = function(trace, i) {
            return [trace.lon[i], trace.lat[i]];
        };
    }

    for(var i = 0; i < N; i++) {
        lonlat = getLonLat(trace, i);
        if(!lonlat) continue;

        cdi.push({
            lon: lonlat[0],
            lat: lonlat[1]
        });
    }

    cdi[0].trace = trace;
    Plotly.Lib.mergeArray(marker.size, cdi, 'ms');
    Plotly.Scatter.arraysToCalcdata(cdi);

    return cdi;
};

function makeLineGeoJSON(trace) {
    var N = trace.lon.length,
        coordinates = new Array(N);
    
    for (var i = 0; i < N; i++) {
        coordinates[i] = [trace.lon[i], trace.lat[i]];
    }

    return {
        type: 'LineString',
        coordinates: coordinates,
        trace: trace
    };
}

plotScatterGeo.plot = function(geo, scattergeoData) {
    var Scatter = Plotly.Scatter,
        topojson = geo.topojson;

    function handleMouseOver(d) {
        console.log('scattergeo: ', d.lon, d.lat);
    }

    function handleMouseOut(d) {
        console.log('-- out')
    }

    var gScatterGeoTraces = geo.framework.select('g.scattergeolayer')
        .selectAll('g.trace.scatter')
        .data(scattergeoData);

    gScatterGeoTraces.enter().append('g')
            .attr('class', 'trace scattergeo');

    gScatterGeoTraces
        .each(function(trace) {
            if(!Scatter.hasLines(trace)) return;
            d3.select(this)
                .append('path')
                .datum(makeLineGeoJSON(trace))
                .attr('class', 'js-line');
        });

    gScatterGeoTraces.append('g')
        .attr('class', 'points')
        .each(function(trace) {
            var s = d3.select(this),
                showMarkers = Scatter.hasMarkers(trace),
                showText = Scatter.hasText(trace),
                cdi = plotScatterGeo.calcGeoJSON(trace, topojson);

            if((!showMarkers && !showText) || trace.visible !== true) {
                s.remove();
                return;
            }

            if(showMarkers) {
                s.selectAll('path.point')
                    .data(cdi)
                    .enter().append('path')
                        .attr('class', 'point')
                        .on('mouseover', handleMouseOver)
                        .on('mouseout', handleMouseOut);
            }

            if(showText) {
                s.selectAll('g')
                    .data(cdi)
                    .enter().append('g')
                        .append('text');
            }
        });

    plotScatterGeo.style(geo);
};

plotScatterGeo.style = function(geo) {
    var selection = geo.framework.selectAll('g.trace.scattergeo');

    selection.style('opacity', function(trace) { return trace.opacity; });

    selection.selectAll('g.points')
        .each(function(trace){
            d3.select(this).selectAll('path.point')
                .call(Plotly.Drawing.pointStyle, trace);
            d3.select(this).selectAll('text')
                .call(Plotly.Drawing.textPointStyle, trace);
        });

    // GeoJSON calc data is incompatible with Plotly.Drawing.lineGroupStyle
    selection.selectAll('path.js-line')
        .style('fill', 'none')
        .each(function(d) {
            var trace = d.trace,
                line = trace.line || {};

            d3.select(this)
                .call(Plotly.Color.stroke, line.color)
                .call(Plotly.Drawing.dashLine, line.dash || '', line.width || 0);
        });
};
