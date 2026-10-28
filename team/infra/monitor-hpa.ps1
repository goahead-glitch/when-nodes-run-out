$log = "aws-vus200-monitor.log"

while ($true) {

    Get-Date | Tee-Object -FilePath $log -Append

    kubectl get hpa -n shoply |
        Tee-Object -FilePath $log -Append

    kubectl top nodes |
        Tee-Object -FilePath $log -Append

    kubectl top pod -n shoply --sort-by=cpu |
        Tee-Object -FilePath $log -Append

    "------------------------" |
        Tee-Object -FilePath $log -Append

    Start-Sleep -Seconds 10
}