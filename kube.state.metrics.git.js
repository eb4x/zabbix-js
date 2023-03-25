var Kube = {
    params: {},

    setParams: function (params) {
        ['api_token', 'api_url', 'state_endpoint_name'].forEach(function (field) {
            if (typeof params !== 'object' || typeof params[field] === 'undefined'
                || params[field] === '') {
                throw 'Required param is not set: "' + field + '".';
            }
        });

        Kube.params = params;
    },

    request: function (query) {
        const request = new HttpRequest();
        request.addHeader('Content-Type: application/json');
        request.addHeader('Authorization: Bearer ' + Kube.params.api_token);

        const url = Kube.params.api_url + query;
        Zabbix.log(4, '[ Kubernetes ] Sending request: ' + url);

        var response = request.get(url);
        Zabbix.log(4, '[ Kubernetes ] Received response with status code ' + request.getStatus());
        Zabbix.log(5, response);

        if (request.getStatus() < 200 || request.getStatus() >= 300) {
            throw 'Request failed with status code ' + request.getStatus() + ': ' + response;
        }

        if (response) {
            try {
                response = JSON.parse(response);
            }
            catch (error) {
                throw 'Failed to parse response received from Kubernetes API. Check debug log for more information.';
            }
        }

        return {
            status: request.getStatus(),
            response: response
        };
    },

    getMetricsEndpointUrl: function () {
        var result = Kube.request('/api/v1/endpoints');

        if (typeof result.response !== 'object'
            || typeof result.response.items === 'undefined'
            || result.status != 200) {
            throw 'Cannot get endpoints from Kubernetes API. Check debug log for more information.';
        };

        var endpointUrl;
        result.response.items.forEach(function (ep) {
            if (ep.metadata.name !== Kube.params.state_endpoint_name) {
                return;
            }
            if (!Array.isArray(ep.subsets)) {
                return;
            }
            if (!ep.subsets[0].addresses) {
                return;
            }

            var scheme, addr, port;
            ep.subsets.forEach(function (subset) {
                subset.ports.forEach(function (item) {
                    if (item.name !== 'http' &&
                        item.name !== 'https' &&
                        item.name !== 'https-main') {
                        return;
                    }

                    scheme = item.name.match('https?');
                    port = item.port;
                });

                // incase subset has multiple addresses, just pick one at random
                const random = Math.floor(Math.random() * subset.addresses.length);
                addr = subset.addresses[random].ip;

                endpointUrl = scheme + "://" + addr + ":" + port;
            });
        });

        return endpointUrl;
    },

    getStateMetrics: function (metricsEndpointUrl) {
        const request = new HttpRequest();
        request.addHeader('Content-Type: application/json');
        request.addHeader('Authorization: Bearer ' + Kube.params.api_token);

        const url = metricsEndpointUrl + '/metrics';
        Zabbix.log(4, '[ Kubernetes ] Sending request: ' + url);

        var response = request.get(url);
        Zabbix.log(4, '[ Kubernetes ] Received response with status code ' + request.getStatus());
        Zabbix.log(5, response);

        if (request.getStatus() < 200 || request.getStatus() >= 300) {
            throw 'Request failed with status code ' + request.getStatus() + ': ' + response;
        }

        if (response === null) {
            throw 'failed to get Kubernetes state metrics. Check debug log for more information.';
        }

        return response;
    }
};

try {
    Kube.setParams(JSON.parse(value));

    var metricsEndpointUrl = Kube.getMetricsEndpointUrl();
    var stateMetrics = Kube.getStateMetrics(metricsEndpointUrl);

    return stateMetrics;
}
catch (error) {
    error += (String(error).endsWith('.')) ? '' : '.';
    Zabbix.log(3, '[ Kubernetes ] ERROR: ' + error);
    return JSON.stringify({ error: error });
}
