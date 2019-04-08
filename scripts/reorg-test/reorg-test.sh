#!/usr/bin/env bash
while [$1 == ""]
do
 ./connect.sh; sleep 95; ./disconnect.sh; sleep 95; 
done
